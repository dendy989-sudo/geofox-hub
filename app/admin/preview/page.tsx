import type { Metadata } from "next";
import { AdminWorkspace } from "@/components/admin/admin-workspace";

export const metadata: Metadata = { title: "Control center preview", robots: { index: false, follow: false } };
export default function PreviewPage() { return <AdminWorkspace preview />; }
