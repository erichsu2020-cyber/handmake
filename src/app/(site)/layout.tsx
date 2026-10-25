import { Suspense } from "react";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UserMenu from "@/components/UserMenu";

// 需要登入的頁面都放在 (site) 底下；登入頁在外面，不會套到這個版面
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader
        userMenu={
          <Suspense fallback={<div className="h-9 w-24" />}>
            <UserMenu />
          </Suspense>
        }
      />
      {children}
      <SiteFooter />
    </>
  );
}
