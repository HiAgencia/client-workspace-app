import type { Metadata } from "next";

// The page runs in the browser, so its title is declared here.
export const metadata: Metadata = { title: "Trash" };

export default function TrashLayout({ children }: LayoutProps<"/app/trash">) {
  return children;
}
