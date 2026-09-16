import { AuthForm } from "@/components/auth/AuthForm";

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy p-6">
      <AuthForm mode="sign-in" />
    </main>
  );
}
