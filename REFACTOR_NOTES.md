# Refactor notes

## Known issue

- The Fees payment-entry controls are rendered inside a `div`, not a `form`. The inputs' native required-field validation and Enter-key form submission therefore do not apply to payment collection. This was observed during the refactor review and has not been changed.
