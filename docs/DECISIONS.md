# Decision log and scope rationale

Update each entry when implementation diverges. Dates in Detroit time.

| Decision | Why | Consequence / mitigation | Status |
|---|---|---|---|
| Support arbitrary uploaded PDFs, not prebuilt MIND template | Reviewer supplies unseen agreement | Manual signature placement before issuing request | Planned |
| Prioritize one signer per file | Matches minimum case agreement workflow | Multi-signer sequence postponed | Planned |
| Offer copy-link workflow even without email | External email credentials/deliverability can fail | Make sending link explicit; add email after reliable core | Planned |
| Manual field placement first | Works on unpredictable PDF layouts | AI auto-detection postponed | Planned |
| Typed/drawn e-signature + consent event | Better end-user usability/evidence than merely attaching PNG | Not proof of identity or legal compliance | Planned |
| Private originals and signed artifacts | Protect case-specific PDFs | Public signer requires token-scoped access | Planned |
| Keep signing workflow minimal before multi-tenant sales features | Eval emphasizes complete working path | Add org isolation if time, explain prototype limits | Planned |

## Deliberately excluded (unless actually implemented)
- AI contract analysis/auto-placement: unreliable on unseen layouts, unnecessary for P0.
- Payment processing/subscriptions: no need to prove one signed agreement.
- Full CRM ecosystem / Zapier / workflow builder: adds integration risk.
- Multi-party routing and witness/notary workflows: requirements don't call for them.
- Regulatory certification/verified identity: cannot honestly establish in a short prototype.

## Open questions resolved by defaults
- File = case for exactly one client. Multiple documents per case can be added later.
- Unknown agreement format = accept standard PDF, not arbitrary Word files unless converter implemented.
- Signer = one invited person; use test data only.
- Evaluation requires no special account registration; provide clearly labeled demo entry, not a public unrestricted administrative backend.
