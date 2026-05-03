import { GoogleGenAI, Type } from "@google/genai";
import { MissionType, Question } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateQuestions(mission: MissionType, wrongAnswers: Question[] = [], customApiKey?: string): Promise<Question[]> {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("No API key provided");
  }
  const ai = new GoogleGenAI({ apiKey });
  
  let prompt = "";
  
  if (mission === MissionType.REVIEW) {
    prompt = `You are Sparky, a fun Year 2 AI tutor. The student struggled with these questions recently: ${JSON.stringify(wrongAnswers)}. 
    Generate 5 new, encouraging review questions based on these concepts. Return a JSON array of 5 questions.
    Each question should have: text, options (array of 3), correctAnswer, and a helpful hint.`;
  } else if (mission === MissionType.MATHS) {
    prompt = `You are Sparky, a fun Year 2 AI tutor. Generate 5 Maths questions for a 7-year-old. 
    Topics: Fractions (1/2, 1/4, 1/3), 2/5/10 times tables, or telling time.
    Return a JSON array of 5 questions. Each with text, options (3 items), correctAnswer, and a hint.`;
  } else if (mission === MissionType.ENGLISH) {
    prompt = `You are Sparky, a fun Year 2 AI tutor. Generate 5 English questions for a 7-year-old.
    Topics: Suffixes (-ly, -ful, -less) and using apostrophes (e.g., the dog's bone).
    Return a JSON array of 5 questions. Each with text, options (3 items), correctAnswer, and a hint.`;
  } else {
    prompt = `You are Sparky, a fun Year 2 AI tutor. Generate 5 Puzzle questions for a 7-year-old.
    Topics: Synonyms (words that mean the same) and simple shape patterns.
    Return a JSON array of 5 questions. Each with text, options (3 items), correctAnswer, and a hint.`;
  }

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctAnswer: { type: Type.STRING },
            hint: { type: Type.STRING }
          },
          required: ["text", "options", "correctAnswer", "hint"]
        }
      }
    }
  });

  const parsed = JSON.parse(response.text || "[]");
  return parsed.map((q: any, i: number) => ({
    ...q,
    id: `${mission}-${Date.now()}-${i}`,
    mission
  }));
}
