// Tenant branding, chosen at build time with VITE_BRAND. One artifact serves
// every tenant: a tenant gets its name, marks, palette and contacts by config,
// never by editing copy. Capability ids, MCP tool names and routes never change
// with the brand; only what a person reads does.

type Brand = {
  id: string;
  /** The product name people read in the app chrome, titles and emails. */
  name: string;
  /** The organization behind it, for "by ..." lines. */
  owner: string;
  /** Square mark used in the sidebar, auth and consent pages. */
  logo: string;
  /** Folder under /public holding favicons and site.webmanifest. */
  assetDir: string;
  /** VITE_BRAND_SUPPORT_EMAIL sets it per deployment. */
  supportEmail: string;
  /** Public site the product links back to. */
  websiteUrl: string;
  /** User agent the crawler and reference fetcher announce. */
  crawlerAgent: string;
  /**
   * Whether to show the upstream open-source pitch: the public plugin and
   * skills, "Try ..." links on shared reports, the referral footer.
   */
  showUpstreamPromotion: boolean;
};

const BRANDS: Record<string, Brand> = {
  openseo: {
    id: "openseo",
    name: "OpenSEO",
    owner: "OpenSEO",
    logo: "/transparent-logo.png",
    assetDir: "",
    supportEmail: "ben@openseo.so",
    websiteUrl: "https://openseo.so",
    crawlerAgent: "OpenSEO-Audit/1.0",
    showUpstreamPromotion: true,
  },
  aic: {
    id: "aic",
    name: "AIC SEO",
    owner: "Alberta Indoor Comfort",
    logo: "/brands/aic/logo.png",
    assetDir: "/brands/aic",
    supportEmail: "",
    websiteUrl: "https://albertaindoorcomfort.com",
    crawlerAgent: "AIC-SEO-Audit/1.0",
    showUpstreamPromotion: false,
  },
};

function resolveBrand(id: string | undefined, supportEmail?: string): Brand {
  const brand = (id && BRANDS[id]) || BRANDS.openseo;
  return supportEmail ? { ...brand, supportEmail } : brand;
}

/** The crawler's product token, as site owners see it in their logs. */
export function crawlerName(brand: Brand = BRAND): string {
  return brand.crawlerAgent.split("/")[0];
}

export const BRAND: Brand = resolveBrand(
  import.meta.env?.VITE_BRAND,
  import.meta.env?.VITE_BRAND_SUPPORT_EMAIL,
);

/** Favicon, touch icon and manifest paths for the active brand. */
export function brandAsset(file: string): string {
  return `${BRAND.assetDir}/${file}`;
}
