import { fetchDomainRankOverview } from "@/server/lib/dataforseo/labs";
import { trackDataforseoSample } from "@/server/lib/dataforseo/sample-scope";
import { AppError } from "@/server/lib/errors";

/**
 * The public widget's provider call. A visitor never sees sample data as their
 * domain's numbers, and it is never cached as a result: a sample answer (no
 * DataForSEO key, or a refusal) fails like any other provider error.
 */
export async function fetchLiveDomainRankOverview(
  input: Parameters<typeof fetchDomainRankOverview>[0],
) {
  const { value, sample } = await trackDataforseoSample(() =>
    fetchDomainRankOverview(input),
  );
  if (sample) {
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "DataForSEO answered with sample data",
    );
  }
  return value;
}
