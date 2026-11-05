"use client";

import { useState } from "react";
import { Icon } from "@/components/admin/icons";
import type { RecordsProps } from "@/lib/finance/types";
import { VendorsPanel } from "./vendors";
import { TagsPanel } from "./tags-panel";

export function VendorsAndTagsPanel(props: RecordsProps) {
  const [section, setSection] = useState<"vendors" | "tags">("vendors");
  return <div className="fn-stack">
    <div className="fn-tabs" aria-label="Vendors and tags sections">
      <button className={`fn-tab ${section === "vendors" ? "active" : ""}`} aria-pressed={section === "vendors"} onClick={() => setSection("vendors")}><Icon name="globe" size={15} /> Vendors</button>
      <button className={`fn-tab ${section === "tags" ? "active" : ""}`} aria-pressed={section === "tags"} onClick={() => setSection("tags")}><Icon name="layers" size={15} /> Tags</button>
    </div>
    {section === "vendors" ? <VendorsPanel {...props} /> : <TagsPanel {...props} />}
  </div>;
}
