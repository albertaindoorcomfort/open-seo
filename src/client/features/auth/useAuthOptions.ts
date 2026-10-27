import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

const authOptionsSchema = z.object({
  google: z.boolean(),
  passwordResetEmail: z.boolean(),
  inviteOnly: z.boolean(),
});

// What this deployment's sign-in and sign-up offer (Google, reset mail, the
// invite gate), from the public /api/auth-options route. data is undefined
// until the server answers.
export function useAuthOptions() {
  return useQuery({
    queryKey: ["auth-options"],
    queryFn: async () => {
      const response = await fetch("/api/auth-options");
      if (!response.ok) {
        throw new Error(`Auth options request failed: ${response.status}`);
      }
      return authOptionsSchema.parse(await response.json());
    },
    staleTime: Infinity,
  });
}
