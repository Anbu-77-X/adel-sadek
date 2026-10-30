---
title: Negative Cart Totals
date: 2026-10-30
---

![A rental cart pulled down to a negative total](negative-cart-totals/hero.png)

> Swapping the dates on a second add dragged a rental cart to −€477,673.13.

**Status.** Reported, fixed, and closed as a duplicate. Someone reached it before me. The reasoning is still worth writing down.

**Class.** Business logic. The cart update path did not validate the rental period. Severity is medium: it needs an authenticated account, and the checkout behavior was not tested.

---

## A note on how I label things

This was a black-box test. I never saw the source code, so every statement is one of two kinds.

- **Observed.** Taken from a request or a response.
- **Hypothesis.** My inference about the backend. I mark these so you can weigh them.

Where I could not confirm something, I say so in **What I didn't verify**.

---

## TL;DR

The target is an e-commerce platform with a rental feature. You pick an item, choose a start and an end date, and the backend prices the line by its duration.

Adding a rental with an end date before its start date is rejected the first time. The create path validates the period. Adding the same product a second time returns `cartUpdateResult: UPDATED`. That update path accepted a reversed range and priced the line negative. One poisoned line pulled the rental total to **−€477,673.13**.

My core hypothesis: the create path and the update path do not share the same validation. The first write is guarded. The second write is not.

I stopped at the cart. I never attempted checkout with a negative or zero total, so everything about payment below is reasoning, not a test.

---

## Scope and ground rules

- The target and the program are redacted. I am not naming the company.
- Black-box only. Backend claims are inferences, labeled as above.
- I tested with my own account and stopped at the cart.
- The figures omit request headers. Two original captures were the same file, so one of them is used.

---

## 1. Mapping the feature

**How I got here.** I opened a rentable product and watched the network tab while changing the rental dates.

The rental dates are not decoration. They ride on the cart line and drive the server-computed price.

- Add-to-cart request: `POST /api/rental`
- Payload shape: `{"productCode":"018517","storeId":39,"startDate":[2026,10,31,17,0,0],"endDate":[2026,11,20,17,0,0],"quantity":1}`
- Cart response: each line carries a server-computed price.

![The rental request beside a cart update](negative-cart-totals/rental-request.png)

*The dates travel with the line. This add was answered as an update.*

**Observed.** A valid rental prices correctly and positively. In the capture below: €20 rent, €2 waiver, €22 total, and a €50 deposit. The server owns the price.

![A valid rental priced at twenty-two euro](negative-cart-totals/positive-total.png)

*A normal period. The total stays positive.*

That is the right design, and it also means the pricing function is the single point of failure. The question stops being whether I can tamper with the price. It becomes whether I can hand the formula an input the developer never imagined. Dates are user-controlled, so that is the lever.

---

## 2. Finding the edges of the booking window

**How I got here.** Before trying anything clever, I probed the limits. I pushed the dates further into the future until the server pushed back.

**Observed.** An out-of-window period was rejected. The range was in the right order, start before end, but the end was too far in the future.

- Request: `{"productCode":"018517","storeId":39,"startDate":[2030,10,31,17,0,0],"endDate":[2031,11,20,17,0,0],"quantity":1}`
- Response: `{"success":false,"errorCode":"RENTAL_PERIOD_INVALID","cartUpdateResult":"NOT_UPDATED","validationErrors":[]}`

![The far-future dates on the rental request](negative-cart-totals/window-request.png)

*The dates are in order.*

![The server refusing that period](negative-cart-totals/window-response.png)

*They are simply outside the window.*

This is not a reversed range. What it proves is narrower, and still important.

The valid window tops out somewhere around 2031, roughly five years out. More important for the rest of the story: real validation exists on the create path. A code path inspects the rental period and refuses it with `RENTAL_PERIOD_INVALID` before the line is created.

Hold that thought. The bug is a second path that does not run this same check.

---

## 3. How strict is the date validation?

**How I got here.** I started feeding the add-to-cart request reversed and malformed ranges.

- **Observed.** The create path enforces an out-of-window check. A correctly ordered but too-far-future range is rejected with `RENTAL_PERIOD_INVALID` and `NOT_UPDATED`. A period-validation path exists on create.
- **What I did not capture cleanly.** A reversed range, end before start, rejected on a fresh add in isolation. I am confident the create path guards the period. The out-of-window rejection proves a check runs. My clean evidence is for the out-of-window case, not specifically for a reversed range on create.
- **Hypothesis, not fully confirmed.** The validator may compare only the date and ignore the time, so a same-day range with the end time before the start time could slip through as a negative hour. Nothing later depends on that. The finding is the second write, not a one-hour trick.

---

## 4. The second add

This is the heart of it.

**How I got here.** I added a product, then added the same product again, and watched what the API called the result.

**Observed.** The second add came back as an update, not a new line.

- Response: `{"success":true,"cartUpdateResult":"UPDATED","validationErrors":[],"cart":{ … }}`
- The resulting rental line did not carry the dates I had just sent. The cart identifies a rental line by product, not by the dates on the request.

One action, "add this item," resolves to two server behaviors.

- **First add, create path.** The line does not exist yet. The server creates it, runs the period validation from section 2, and prices it. The price is positive.
- **Second add, update path.** The line already exists, keyed by product. The server updates it with the new dates. This is where the reversed range got through and the line price went negative.

**Hypothesis.** The update path re-reads the start and end dates and does not re-run the period validation that the create path runs, or it runs a weaker version. The evidence lines up: validation exists on create, the re-add is explicitly `UPDATED`, and the cart ends up holding a negative line.

The second add used a range reversed by about a year, so the duration goes strongly negative:

```json
{
  "productCode": "018517",
  "storeId": 39,
  "startDate": [2031, 10, 31, 11, 0, 0],
  "endDate": [2030, 10, 31, 10, 0, 0],
  "quantity": 100
}
```

The takeaway: two code paths for one action, and only one of them is guarded. Worth hunting in any cart, wishlist, or booking flow.

---

## 5. Why the price goes negative

**Hypothesis. Illustrative only, not reconstructed from code.** A pricing function shaped like this would reproduce what I saw:

```text
function price(item, start, end):
    hours = (end - start) / 3600
    if hours < 24:
        return ceil(hours) * item.hourlyRate
    return ceil(hours / 24) * item.dailyRate
```

With a reversed range, `hours` is negative. Any negative value is less than 24, so it falls into the hourly branch and the result is a negative line price. There is no `hours > 0` guard. The hypothesis is that the developer assumed validation had already guaranteed a positive duration. On the create path, it had. On the update path, it had not.

**Open question.** I cannot fully reconcile the magnitude with the baseline. The second add carried `quantity: 100`, so part of the huge number is the line price multiplied across 100 units. Even accounting for that, a normal rental priced at about €20 and a reversed line at −€434,880 do not sit cleanly on the same per-day rate. The exact formula, and the exact reversed span, stays unconfirmed. The sign and the direction are solid. The precise arithmetic is still open.

The lesson survives either way. Validation and pricing were two separate trust zones, and the update path let me skip the first one.

---

## 6. The poisoned cart

**How I got here.** A cart is an aggregate. Once one line is negative, it drags the total down and offsets every positive line.

**Observed**, straight from the cart response:

| Field | Value |
| --- | --- |
| Poisoned line `rentalPrice` | −€434,880.00 |
| Poisoned line `damageWaiverPrice` (10%) | −€43,488.00 |
| Poisoned line `totalPrice` | −€478,368.00 |
| Cart `totalRentalRentPrice` | −€434,248.30 |
| Cart `totalDamageWaiverPrice` | −€43,424.83 |
| Cart `totalRentalPrice` | −€477,673.13 |

The rent subtotal of −€434,248.30 implies a positive line of about +€631.70 being swallowed by the negative one. The total is that subtotal plus the 10% damage waiver.

![The cart total after the reversed rental](negative-cart-totals/negative-total.png)

*The response itself. These numbers are server-side state.*

The API response holds the negative values, so this is not a front-end rendering glitch.

**Not verified.** Whether these rental totals are ever combined with regular, non-rental items into a single grand total. The response keeps `entries` and `rentalEntries` separate.

---

## 7. The payment layer

**Not tested.** I stopped at the cart. This section is reasoning about how payment processors generally behave, not something I confirmed against this target.

- A processor validates what it is sent. The amount has to be positive and above a minimum. It has no concept of what the cart should cost.
- If the backend submits one positive total, for example a €100 item offset by a −€80 line and charged as €20, the processor charges it. The number it received looks fine.
- If the total is negative, the processor almost certainly rejects the amount. That protects the processor, not the merchant's inventory or books.
- The dangerous edge is a total of exactly 0. Many stores have a path for free orders, and a negative line can land the total there.

The processor is a calculator you hand a number to. The number has to be correct before it arrives. I left the provider unnamed because I did not verify it.

---

## What I didn't verify

- Whether the negative rental total is ever combined with non-rental items into one grand total.
- What checkout and the payment step actually do with a zero or negative total.
- Whether a same-day reversed range is accepted on the create path.
- The real pricing formula, and the exact reversed span and quantity behind the −€434,880 line.
- A clean side-by-side capture of the create response and the update response for the same reversed range.

---

## How the two paths line up

```text
POST /api/rental
        |
        +-- no line yet ---- create
        |                      |
        |                      +-- period refused --> RENTAL_PERIOD_INVALID
        |                      +-- period accepted -> positive price
        |
        +-- line already there -- update
                                   |
                                   +-- reversed dates
                                         |
                                         +-- negative line
                                               |
                                               +-- poisoned cart total
```

---

## Root cause, my best reading

1. No shared `end > start` check on the update path. Validation lives on create. This is the primary, well-supported point.
2. A pricing function with no check for a negative duration or a negative result.
3. The cart tolerates a line priced at zero or below.
4. Unconfirmed: the validator may look at the day and ignore the time. That is a lead, not a finding.

---

## Impact

- Offset legitimately priced items with negative rental lines, and pay less than the value.
- Possibly steer a cart to a zero total that skips payment, depending on checkout. Not tested.
- Inventory and revenue loss, plus messy refund and accounting side effects.

---

## Recommended fixes

1. Validate `end > start`, with the full datetime and timezone, on every path: create, update, and merge.
2. Put the period rules in one shared function called by both paths.
3. Reject non-positive durations and non-positive prices inside the pricing function itself.
4. At checkout, recompute the cart and fail if any line is `<= 0`.
5. Do not create a zero-payment order unless the free total was legitimately computed.
6. Add regression tests for reversed ranges, the edge of the booking window, add-twice, and add-after-update.

---

## Takeaways

- Hunt the second write. Create, update, and merge are often separate paths, and only one of them gets the validation. If the first add is clean, add again.
- Probe the edges. Booking-window limits are usually enforced by different code than the pricing.
- "The server computes the price" is not the end of the story. Ask what inputs the formula was never tested with.
- The payment processor is not the business logic. It only sees the number it is given.

---

**Disclosure.** Published with the program's permission. The issue was reported, fixed, and closed as a duplicate of an earlier report.

*Thanks for reading. This is my first writeup.*
