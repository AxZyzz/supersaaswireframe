import { SiteFooter, SiteNav } from "@/components/marketing/site-chrome";

export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-surface">
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
