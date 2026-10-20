import { redirigerSection } from "@/components/acces/OngletsSection";

/** /moi : premier onglet ouvrable pour ce rôle. */
export default async function MoiPage() {
  return redirigerSection("moi");
}
