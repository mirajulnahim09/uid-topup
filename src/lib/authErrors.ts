/**
 * NextAuth puts `?error=<code>` on `/login` (pages.signIn and pages.error) when
 * a sign-in fails outside the credentials form — above all Google sign-in.
 * Before, the login page ignored it and the customer saw nothing at all.
 * Codes: https://next-auth.js.org/configuration/pages#error-codes
 */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'AccessDenied':
      // signIn callback refused: banned account, or 2FA enabled (Google skips the code)
      return 'এই অ্যাকাউন্টে Google দিয়ে ঢোকা যাবে না। 2FA চালু থাকলে ইমেইল + পাসওয়ার্ড + Authenticator কোড দিয়ে লগইন করুন; অন্য সমস্যায় সাপোর্টে যোগাযোগ করুন।';
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
    case 'Callback':
      return 'Google দিয়ে লগইন সম্পূর্ণ হয়নি — আবার চেষ্টা করুন।';
    case 'OAuthAccountNotLinked':
      return 'এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে — ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন।';
    case 'SessionRequired':
      return 'এই পাতা দেখতে আগে লগইন করুন।';
    case 'Configuration':
      return 'লগইন ব্যবস্থায় সাময়িক সমস্যা — একটু পরে আবার চেষ্টা করুন।';
    case 'CredentialsSignin':
      return 'ইমেইল বা পাসওয়ার্ড ভুল';
    default:
      return 'লগইন করা যায়নি — আবার চেষ্টা করুন।';
  }
}
