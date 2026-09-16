import { AuthForm } from "@/components/auth/AuthForm";

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-navy p-6">
      <AuthForm mode="sign-up" />
    </main>
  );
}
