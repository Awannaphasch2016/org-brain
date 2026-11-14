<!-- approval: required -->
<!-- sources: tor-reference -->
<!-- priority: 100 -->

# TOR drafting

This guideline is not approved knowledge. It must not be packaged into an agent sandbox until Anak records approval in the knowledge manifest.

Use it only while drafting a TOR, before that TOR is baselined. After the baseline, the TOR is immutable.

## Identifiers

- An in-scope item is `IS-nnn`, three digits, unique in the TOR.
- An out-of-scope item is `OS-nnn`, three digits, unique in the TOR.
- At least one `IS-nnn` and one `OS-nnn` are required.
- The phrase "none identified" does not replace an identifier.

## Field states

Every required section from the TOR structure skeleton has one state: `missing`, `draft`, `clarified`, or `confirmed`. A TOR is ready for its pull request only when every required field is `confirmed`.

Record the states in `docs/tor-analysis.md`. Do not put an approval status in section 1.1.

Target dates are optional. A timeline section may say that no date is set.

## Readiness

Do not open the TOR pull request while any required field is unconfirmed, any `G-nnn` gap is `blocking | unresolved`, or a `TEL-nnn` item of class `conflict` is neither `rejected` nor `escalated`.

## A2-01 template

`docs/tor-analysis.md` uses these sections:

## Extraction

What the raw upload says, kept separate from inference.

## Field status

| Field | Status |
| --- | --- |
| 1.1 Document Identification | confirmed |

## Gap register

- G-001 | nonblocking | resolved | summary

"blocking" means Gate 1 readiness cannot be validated. "nonblocking" may remain unresolved.

## Assumptions

Assumptions that are not yet confirmed facts.

## Risks

Risks that affect the TOR, not an implementation design.

## Work products

- A2-01
- WP-PS-SOW-01
- WP-PS-PR-01

## TEL template

`docs/tor-elicitation-log.md` uses `TEL-nnn`. Do not use `EL-nnn` in this log.

## TEL-001

class: clarification
resolution: answered

A conflict:

## TEL-002

class: conflict
resolution: rejected
