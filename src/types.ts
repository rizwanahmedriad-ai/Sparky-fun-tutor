export enum MissionType {
  MATHS = "Maths",
  ENGLISH = "English",
  PUZZLES = "Puzzles",
  REVIEW = "Review"
}

export interface Question {
  id: string;
  text: string;
  options: string[];
  correctAnswer: string;
  hint: string;
  mission: MissionType;
}

export interface UserProgress {
  uid: string;
  hearts: number;
  stars: number;
  wrongAnswers: Question[];
  lastSessionDate: string | null;
  currentMission: MissionType | "Completed" | null;
  questionCount: number;
}
