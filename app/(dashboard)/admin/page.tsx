import { redirigerSection } from "@/components/acces/OngletsSection";

/** /admin : premier onglet ouvrable pour ce rôle. */
export default async function AdminPage() {
  return redirigerSection("admin");
}
