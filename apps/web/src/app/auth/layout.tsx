export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4">
      <div className="relative z-10 w-full max-w-[480px]">
        {children}
      </div>
    </div>
  );
}
