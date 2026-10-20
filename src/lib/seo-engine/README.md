# Lunar SEO engine (vendored)

A copy of `lib/seo-engine` from Mission Control (Lunar Studio, branch `studio-index-seo`). It is pure TypeScript with
relative imports only: the content scorer, the content reference builder, keyword and SERP contracts, and the
deterministic sample data both products show before a key or credits exist.

Change it in Mission Control first and copy it here, so Studio and Lunar Optimize score content the same way. It is
excluded from this repository's lint rules (`.oxlintrc.json`) because it follows Mission Control's; its tests run here.
