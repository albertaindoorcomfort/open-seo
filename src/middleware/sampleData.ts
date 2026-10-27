import { createMiddleware } from "@tanstack/react-start";
import { noteDataforseoAnswer } from "@/client/lib/sample-data";
import {
  trackDataforseoSample,
  type DataforseoAnswer,
} from "@/server/lib/dataforseo/sample-scope";

// Server half: records what DataForSEO answered while this server function ran
// (null when it made no call) and sends it back with this response only.
const reportDataforseoAnswer = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const pending: { dataforseoAnswer: DataforseoAnswer | null } = {
      dataforseoAnswer: null,
    };
    const { value: result, answer } = await trackDataforseoSample(() =>
      next({ sendContext: pending }),
    );
    return {
      ...result,
      sendContext: { ...result.sendContext, dataforseoAnswer: answer },
    };
  },
);

// Client half: hands the answer to the "Sample data" banner, so only the
// browser that received sample data is told about it.
export const sampleDataMiddleware = createMiddleware({ type: "function" })
  .middleware([reportDataforseoAnswer])
  .client(async ({ next }) => {
    const result = await next();
    noteDataforseoAnswer(result.context.dataforseoAnswer);
    return result;
  });
