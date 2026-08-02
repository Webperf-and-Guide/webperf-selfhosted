---
npm/@webperf/config: patch
---

Reduce the consolidated `webperf` runtime image from 426 MB to 381 MB by
using the Bun slim runtime base and excluding console build intermediates,
without removing production dependencies or runtime capabilities.
