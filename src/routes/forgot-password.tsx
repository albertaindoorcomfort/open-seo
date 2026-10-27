import { useForm } from "@tanstack/react-form";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AuthPageCard,
  AuthPageShell,
  authRedirectSearchSchema,
} from "@/client/features/auth/AuthPage";
import { useAuthOptions } from "@/client/features/auth/useAuthOptions";
import { getFieldError, getFormError } from "@/client/lib/forms";
import { authClient } from "@/lib/auth-client";
import { isHostedClientAuthMode } from "@/lib/auth-mode";
import { getSignInSearch, normalizeAuthRedirect } from "@/lib/auth-redirect";
import { SUPPORT_EMAIL } from "@/shared/support";
import { z } from "zod";

const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});

export const Route = createFileRoute("/forgot-password")({
  validateSearch: authRedirectSearchSchema,
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const search = Route.useSearch();
  const redirectTo = normalizeAuthRedirect(search.redirect);
  const isHostedMode = isHostedClientAuthMode();
  const authOptions = useAuthOptions();
  // No mail provider: a reset link can never arrive, so never claim one did.
  // A failed lookup counts as no mail provider too.
  const resetMailUnavailable =
    isHostedMode &&
    !authOptions.isPending &&
    authOptions.data?.passwordResetEmail !== true;

  const form = useForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onSubmit: forgotPasswordSchema,
    },
    onSubmit: async ({ formApi, value }) => {
      try {
        const redirectUrl = new URL("/reset-password", window.location.origin);
        if (redirectTo !== "/")
          redirectUrl.searchParams.set("redirect", redirectTo);
        const result = await authClient.requestPasswordReset({
          email: value.email.trim(),
          redirectTo: redirectUrl.toString(),
        });

        if (result.error) {
          formApi.setErrorMap({
            onSubmit: {
              form: result.error.message || "We couldn't send the reset email.",
              fields: {},
            },
          });
          return;
        }
      } catch {
        formApi.setErrorMap({
          onSubmit: {
            form: "We couldn't send the reset email right now. Please try again.",
            fields: {},
          },
        });
      }
    },
  });

  const backToSignIn = (
    <p className="text-sm">
      <Link
        to="/sign-in"
        search={getSignInSearch(redirectTo)}
        className="text-base-content/50 hover:text-base-content transition-colors"
      >
        Back to sign in
      </Link>
    </p>
  );

  if (resetMailUnavailable) {
    return (
      <AuthPageShell>
        <AuthPageCard
          title="Forgot password"
          helperText="Reset links by email are not available yet."
          footer={backToSignIn}
        >
          <div className="space-y-4">
            <p className="text-sm text-base-content/70">
              Email{" "}
              <a className="link" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              from the address you signed up with, and we will help you back
              into your account.
            </p>
            <a
              className="btn btn-soft w-full"
              href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Lunar Optimize password reset")}`}
            >
              Email support
            </a>
          </div>
        </AuthPageCard>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell>
      <form.Subscribe
        selector={(state) => ({
          isSuccess: state.isSubmitSuccessful && !state.errorMap.onSubmit,
          submittedEmail: state.values.email,
          submitError: state.errorMap.onSubmit,
          isSubmitting: state.isSubmitting,
        })}
      >
        {({ isSuccess, submittedEmail, submitError, isSubmitting }) => {
          const errorMessage = getFormError(submitError);

          return (
            <AuthPageCard
              title={isSuccess ? "Check your email" : "Forgot password"}
              helperText={
                isSuccess
                  ? `If an account exists for ${submittedEmail}, we sent a reset link.`
                  : isHostedMode
                    ? "Enter your email and we'll send you a password reset link."
                    : "Password reset isn't available right now."
              }
              footer={backToSignIn}
            >
              {isSuccess ? (
                <div className="alert alert-success">
                  <span>
                    If an account exists for that email, you'll receive password
                    reset instructions shortly.
                  </span>
                </div>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void form.handleSubmit();
                  }}
                >
                  <form.Field name="email">
                    {(field) => {
                      const error = getFieldError(field.state.meta.errors);

                      return (
                        <div>
                          <input
                            type="email"
                            className="input input-bordered w-full"
                            placeholder="Email address..."
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value)
                            }
                            autoComplete="email"
                            disabled={!isHostedMode}
                            required
                          />
                          {error ? (
                            <p className="mt-1 text-sm text-error">{error}</p>
                          ) : null}
                        </div>
                      );
                    }}
                  </form.Field>

                  {errorMessage ? (
                    <p className="text-sm text-error">{errorMessage}</p>
                  ) : null}
                  <button
                    className="btn btn-soft w-full"
                    disabled={
                      !isHostedMode || isSubmitting || authOptions.isPending
                    }
                  >
                    {isSubmitting ? "Sending reset link..." : "Send reset link"}
                  </button>
                </form>
              )}
            </AuthPageCard>
          );
        }}
      </form.Subscribe>
    </AuthPageShell>
  );
}
