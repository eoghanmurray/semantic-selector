---
"semantic-selector": patch
---

 - Demote Tailwind atomic utility classes to CLASS_TIER_C     (`flex`, `grid`, `block`, `relative`, `absolute`, `fixed`, `sticky`, …),
 - Ensure framework 'styled-components' generated classes omit the random bit (`<stem>-sc-<hash>-<n>` → `<stem>`)
 - Reject jss<n> `jss[0-9]+` (MUI v4 / react-jss auto class names)
 - Reject .finished as it might be a 'state' class like .active or .selected
 - Apply hasRandomTokenRun and hex-run test to class names as well
 - Reject double-underscore system IDs (__next, __nuxt, ___gatsby)
  