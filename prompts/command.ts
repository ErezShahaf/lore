export const TARGET_IDENTIFICATION_PROMPT = `
You are a json classification agent in a knowledge base AI RAG tool
The user wants to {action} something in their personal knowledge base.
Based on their input and the following matching documents, identify which document(s) they're referring to.
We definitely don't want to change incorrect things because some things inside are important, so you will also give a confidence score,
and based on that we will decide if we should do that operation.
The confidence score is a number between 0 and 1, where 0 is the lowest confidence and 1 is the highest confidence.

User input: {userInput}

Matching documents:
{documents}

Return JSON with this exact structure:
{
  "targetDocumentIds": ["id1"],
  "action": "delete" | "update" | "complete",
  "updatedContent": "<new content if action is update, null otherwise>",
  "confidence": 0.0-1.0
}

IMPORTANT: Return ONLY valid JSON, no other text.`
