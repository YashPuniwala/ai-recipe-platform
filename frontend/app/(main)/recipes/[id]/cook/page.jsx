import { getRecipeById } from "@/actions/recipe.actions";
import { checkUser } from "@/lib/checkUser";
import CookingModeClient from "@/components/cooking/CookingModeClient";

export const dynamic = "force-dynamic";

export default async function CookPage({ params }) {
  const user = await checkUser();
  const isPro = user?.subscriptionTier === "pro";

  const { id } = await params;
  const data = await getRecipeById(id);

  return <CookingModeClient recipe={data.recipe} isPro={isPro} />;
}

