export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>;
}
