// Sample emails for the homepage playground. For each one, `quote` and
// `confidence` are an example of what the language model returns; the
// playground then verifies that quote against the passages it retrieved.
export const AUTO_REPLY_MIN_CONFIDENCE = 0.8;

export const samples = [
  {
    label: "What's included?",
    text: "Hi, what's included in your project setup?",
    quote: "Project setup includes a discovery call, configuration and a handover guide.",
    confidence: 0.96,
  },
  {
    label: "A price",
    text: "What does the Starter package cost?",
    quote: "The Starter website package costs €2,400 and covers up to five pages.",
    confidence: 0.95,
  },
  {
    label: "Where's my data?",
    text: "Where are your servers located?",
    quote: "Managed hosting is provided from data centres located in the Netherlands and Germany.",
    confidence: 0.93,
  },
  {
    label: "A refund",
    text: "I was charged twice last month and I want a refund.",
  },
  {
    label: "Not in the documents",
    text: "Do you build mobile apps for iPhone?",
    reason: "None of the saved passages says whether mobile apps are offered, so the AI does not guess.",
    confidence: 0.31,
  },
];
