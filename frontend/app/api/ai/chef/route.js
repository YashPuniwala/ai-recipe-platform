import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { request } from "@arcjet/next";
import { auth } from "@clerk/nextjs/server";
import { checkUser } from "@/lib/checkUser";
import { freeAiChefQuestions, proTierLimit } from "@/lib/arcjet";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "null";
  }
}

export async function POST(req) {
  try {
    const user = await checkUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { sessionId } = await auth();
    if (!sessionId) {
      return NextResponse.json({ error: "No active session" }, { status: 401 });
    }

    const body = await req.json();
    const recipe = body?.recipe;
    const currentStepIndex = body?.currentStepIndex;
    const currentStepText = body?.currentStepText;
    const userMessage = body?.message;

    if (!recipe || !userMessage) {
      return NextResponse.json({ error: "Missing recipe or message" }, { status: 400 });
    }

    const recipeName = recipe?.title || "Recipe";
    const ingredients = (recipe?.ingredients || [])
      .map((i) => `${i.amount ? `${i.amount} ` : ""}${i.item || ""}`.trim())
      .filter(Boolean)
      .join(", ");
    const allSteps = (recipe?.instructions || [])
      .map((s) => `${s.step}. ${s.title ? `${s.title}: ` : ""}${s.instruction}`)
      .join("\n");

    const systemPrompt = `You are an expert sous-chef helping a user cook in real time. Be concise and practical. For substitutions give ONE best option with exact quantity. For unit conversions just give the number. The user is actively cooking so keep it short. Current recipe: ${recipeName}. Ingredients: ${ingredients}. All steps: ${allSteps}. User is on step ${currentStepIndex}: ${currentStepText}`;

    // ARCJET quota: free users get 5 per session, pro unlimited-ish
    const isPro = user.subscriptionTier === "pro";
    const arcjetClient = isPro ? proTierLimit : freeAiChefQuestions;
    const arcjetReq = await request();
    const decision = await arcjetClient.protect(arcjetReq, {
      userId: user.clerkId,
      sessionId,
      requested: 1,
    });

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        return NextResponse.json(
          {
            error: isPro
              ? "AI request limit reached. Please contact support."
              : "Free AI Chef limit reached (5 per session). Upgrade to Pro for unlimited.",
          },
          { status: 429 }
        );
      }
      return NextResponse.json({ error: "Request denied" }, { status: 403 });
    }

    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "Server missing GEMINI_API_KEY" }, { status: 500 });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const prompt = `${systemPrompt}\n\nUser message: ${userMessage}\n\nRespond with a short, practical answer.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = (response.text() || "").trim();

    return NextResponse.json({ answer: text || "I’m not sure. Try rephrasing." });
  } catch (e) {
    return NextResponse.json(
      { error: e?.message || "Server error", details: safeJson(e) },
      { status: 500 }
    );
  }
}

