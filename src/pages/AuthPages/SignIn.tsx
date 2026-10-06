import PageMeta from "../../components/common/PageMeta";
import AuthLayout from "./AuthPageLayout";
import SignInForm from "../../components/auth/SignInForm";

export default function SignIn() {
  return (
    <>
      <PageMeta
        title="Sign in | SmartDoc"
        description="Sign in to SmartDoc"
      />
      <AuthLayout>
        <SignInForm />
      </AuthLayout>
    </>
  );
}
