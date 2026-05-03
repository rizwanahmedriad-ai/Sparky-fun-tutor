import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, db, handleFirestoreError, OperationType } from './lib/firebase.ts';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { MissionType, UserProgress, Question } from './types.ts';
import { generateQuestions } from './lib/gemini.ts';
import { Heart, Star, Trophy, RefreshCw, LogIn, Sparkles } from 'lucide-react';

const INITIAL_PROGRESS: Omit<UserProgress, 'uid' | 'lastSessionDate'> = {
  hearts: 3,
  stars: 0,
  wrongAnswers: [],
  currentMission: null,
  questionCount: 0,
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [progress, setProgress] = useState<UserProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [feedback, setFeedback] = useState<{ type: 'correct' | 'wrong' | 'hint', message: string } | null>(null);
  const [showRecharge, setShowRecharge] = useState(false);
  const [apiKey, setApiKey] = useState<string>(process.env.GEMINI_API_KEY || '');
  const [keyValidated, setKeyValidated] = useState<boolean>(!!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('AIza'));
  const [tempKey, setTempKey] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await loadUserProgress(u.uid);
      } else {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const validateAndSetKey = (key: string) => {
    if (key.startsWith('AIza')) {
      setApiKey(key);
      setKeyValidated(true);
      return true;
    }
    return false;
  };

  const loadUserProgress = async (uid: string) => {
    const docRef = doc(db, 'users', uid);
    try {
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as UserProgress;
        
        // Check if 24 hours passed to reset missions
        const lastDate = data.lastSessionDate ? new Date(data.lastSessionDate) : null;
        const now = new Date();
        const diffHours = lastDate ? (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60) : 24;

        if (diffHours >= 24) {
          const resetData = { 
            ...data, 
            hearts: 3, 
            currentMission: null, 
            questionCount: 0 
          };
          setProgress(resetData);
          await updateDoc(docRef, { 
            hearts: 3, 
            currentMission: null, 
            questionCount: 0 
          });
        } else {
          setProgress(data);
        }
      } else {
        const newProgress = { ...INITIAL_PROGRESS, uid, lastSessionDate: null };
        await setDoc(docRef, { ...newProgress, createdAt: serverTimestamp() });
        setProgress(newProgress as UserProgress);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
    }
  };

  const startMission = async (mission: MissionType) => {
    if (!progress) return;
    setLoading(true);
    try {
      const qs = await generateQuestions(mission, progress.wrongAnswers, apiKey);
      setQuestions(qs);
      setCurrentIdx(0);
      setProgress(prev => prev ? { ...prev, currentMission: mission } : null);
      
      const docRef = doc(db, 'users', progress.uid);
      await updateDoc(docRef, { currentMission: mission });
    } catch (err) {
      console.error(err);
      // Gentle error fallback for key issues
      if (err instanceof Error && (err.message.includes('API key') || err.message.includes('quota'))) {
        setKeyValidated(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnswer = async (answer: string) => {
    if (!progress || !questions[currentIdx]) return;

    const correct = answer === questions[currentIdx].correctAnswer;
    const docRef = doc(db, 'users', progress.uid);

    if (correct) {
      setFeedback({ type: 'correct', message: 'YAY! You got it! 🌟 +10 Stars!' });
      const newStars = progress.stars + 10;
      const nextIdx = currentIdx + 1;
      
      setTimeout(async () => {
        setFeedback(null);
        if (nextIdx >= 5) {
          // Mission Complete
          setProgress(prev => prev ? { 
            ...prev, 
            stars: newStars, 
            currentMission: 'Completed',
            lastSessionDate: new Date().toISOString()
          } : null);
          await updateDoc(docRef, { 
            stars: newStars, 
            currentMission: 'Completed',
            lastSessionDate: new Date().toISOString()
          });
        } else {
          setCurrentIdx(nextIdx);
          setProgress(prev => prev ? { ...prev, stars: newStars } : null);
          await updateDoc(docRef, { stars: newStars });
        }
      }, 2000);
    } else {
      const newHearts = progress.hearts - 1;
      const updatedWrongAnswers = [...progress.wrongAnswers, questions[currentIdx]];
      
      if (newHearts <= 0) {
        setFeedback({ type: 'wrong', message: 'Oh no! Hearts empty! 💔 Time for some energy!' });
        setTimeout(() => {
          setShowRecharge(true);
          setFeedback(null);
        }, 2000);
      } else {
        setFeedback({ type: 'hint', message: `Not quite! Here is a hint: ${questions[currentIdx].hint} 🤔` });
      }

      setProgress(prev => prev ? { 
        ...prev, 
        hearts: Math.max(0, newHearts),
        wrongAnswers: updatedWrongAnswers
      } : null);
      await updateDoc(docRef, { 
        hearts: Math.max(0, newHearts),
        wrongAnswers: updatedWrongAnswers
      });
    }
  };

  const handleRecharge = async () => {
    if (!progress) return;
    const docRef = doc(db, 'users', progress.uid);
    setProgress(prev => prev ? { ...prev, hearts: 3 } : null);
    await updateDoc(docRef, { hearts: 3 });
    setShowRecharge(false);
    setCurrentIdx(0); // Restart current mission progress? Or just keep going? Rules say Game Over = रिचार्ज. 
    // Usually game over resets the current mission state for simplicity.
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-sky-100">
        <motion.div
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="text-6xl mb-4"
        >
          🚀
        </motion.div>
        <p className="text-xl font-bold text-sky-600">Sparky is coming! 🌟</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-b from-sky-400 to-blue-600 text-white p-6 text-center">
        <h1 className="text-5xl font-black mb-4 drop-shadow-lg">Sparky 🚀</h1>
        <p className="text-xl mb-8 max-w-md">Your fun AI tutor for Maths, English, and Puzzles! 🌈✨</p>
        <button
          onClick={handleLogin}
          className="bg-yellow-400 hover:bg-yellow-300 text-blue-900 font-black px-8 py-4 rounded-full flex items-center gap-3 transition-transform hover:scale-105 active:scale-95 shadow-xl text-xl"
        >
          <LogIn size={28} /> Start Learning!
        </button>
      </div>
    );
  }

  if (!keyValidated) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-indigo-600 to-sky-700 text-white p-6 text-center">
        <motion.div
           initial={{ y: -20, opacity: 0 }}
           animate={{ y: 0, opacity: 1 }}
           className="bg-white/10 backdrop-blur-md p-8 rounded-[2.5rem] shadow-2xl max-w-lg w-full border border-white/20"
        >
          <h1 className="text-4xl font-black mb-4">🚀 Mission Control!</h1>
          <p className="text-lg mb-6 leading-relaxed">
            Welcome to Sparky Mission Control! To start learning, I need a special key from Google. 
            Get your free key here: <br/>
            <a 
              href="https://aistudio.google.com/app/apikey" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-yellow-300 underline font-bold hover:text-yellow-200 transition-colors"
            >
              https://aistudio.google.com/app/apikey
            </a> 
            <br/> (Click 'Create API key'). Once you have it, paste it here!
          </p>
          <div className="relative group">
            <input
              type="password"
              placeholder="Paste your AIza... key here"
              className="w-full bg-white/20 border-2 border-white/30 rounded-2xl py-4 px-6 text-white placeholder-white/60 focus:outline-none focus:border-yellow-300 transition-all text-center mb-6"
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
            />
          </div>
          <button
            onClick={() => {
              if (validateAndSetKey(tempKey)) {
                // Success
              } else {
                alert("Oops! That key doesn't look quite right! Remember, it usually starts with AIza... 🚀");
              }
            }}
            className="w-full bg-yellow-400 hover:bg-yellow-300 text-blue-900 font-black py-4 rounded-2xl shadow-xl transition-all active:scale-95 text-xl"
          >
            Connect to Sparky! 🛰️
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-sky-50 font-sans p-4 md:p-8 flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-4xl flex items-center justify-between mb-8 bg-white p-4 rounded-3xl shadow-sm border-b-4 border-sky-200">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-pink-100 px-4 py-2 rounded-2xl border-2 border-pink-200">
            {[...Array(3)].map((_, i) => (
              <Heart 
                key={i} 
                size={24} 
                className={i < (progress?.hearts || 0) ? 'fill-pink-500 text-pink-500' : 'text-pink-200'} 
              />
            ))}
          </div>
          <div className="flex items-center gap-2 bg-yellow-100 px-4 py-2 rounded-2xl border-2 border-yellow-200">
            <Star size={24} className="fill-yellow-400 text-yellow-500" />
            <span className="text-xl font-black text-yellow-700">{progress?.stars || 0}</span>
          </div>
        </div>
        <div className="hidden md:block">
           <h2 className="text-2xl font-black text-sky-600">Hi, I'm Sparky! 🚀</h2>
        </div>
        <div className="flex items-center gap-4">
           {/* User Avatar could go here */}
           <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-sky-400 shadow-md">
             <img src={user.photoURL || ''} alt="me" />
           </div>
        </div>
      </div>

      <main className="w-full max-w-4xl flex-1 flex flex-col items-center">
        <AnimatePresence mode="wait">
          {showRecharge ? (
            <motion.div
              key="recharge"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              className="bg-white p-8 rounded-3xl shadow-2xl text-center border-4 border-red-400 max-w-md w-full"
            >
              <h1 className="text-6xl mb-4">💔</h1>
              <h2 className="text-3xl font-black text-red-500 mb-4">GAME OVER!</h2>
              <p className="text-xl text-gray-600 mb-8 italic">
                You run out of hearts! Quick! Do <span className="font-black text-red-500 text-2xl">10 Star Jumps</span> to recharge your energy! ⚡
              </p>
              <button
                onClick={handleRecharge}
                className="w-full bg-red-400 hover:bg-red-500 text-white font-black py-4 rounded-2xl text-xl shadow-lg transition-transform active:scale-95"
              >
                I did them! Recharge! ❤️❤️❤️
              </button>
            </motion.div>
          ) : progress?.currentMission === 'Completed' ? (
            <motion.div
              key="victory"
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="bg-white p-8 rounded-3xl shadow-2xl text-center border-4 border-yellow-400 max-w-md w-full"
            >
              <motion.div
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="text-8xl mb-4"
              >
                🏆
              </motion.div>
              <h2 className="text-3xl font-black text-yellow-600 mb-4">VICTORY TROPHY!</h2>
              <p className="text-xl text-gray-600 mb-8">
                You were AMAZING today! 🌟 You've finished your missions. Come back in 24 hours for new adventures! 🌈✨
              </p>
              <div className="flex items-center justify-center gap-2 text-yellow-700 font-bold">
                <Sparkles /> <span>Total Stars: {progress.stars}</span>
              </div>
            </motion.div>
          ) : !progress?.currentMission ? (
            <div key="select" className="w-full grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                { type: MissionType.MATHS, emoji: "🔢", color: "bg-orange-400", desc: "Numbers & Shapes!" },
                { type: MissionType.ENGLISH, emoji: "✍️", color: "bg-green-400", desc: "Words & Fun!" },
                { type: MissionType.PUZZLES, emoji: "🧩", color: "bg-purple-400", desc: "Think Big!" },
                { type: MissionType.REVIEW, emoji: "🔄", color: "bg-blue-400", desc: "Let's Practice!", disabled: (progress?.wrongAnswers.length || 0) === 0 },
              ].map((m) => (
                <button
                  key={m.type}
                  disabled={m.disabled}
                  onClick={() => startMission(m.type as MissionType)}
                  className={`${m.color} ${m.disabled ? 'opacity-50 grayscale cursor-not-allowed' : 'hover:scale-105 active:scale-95'} p-8 rounded-3xl shadow-xl flex items-center gap-6 transition-all group overflow-hidden relative`}
                >
                  <div className="text-6xl z-10">{m.emoji}</div>
                  <div className="text-left z-10">
                    <h3 className="text-2xl font-black text-white">{m.type}</h3>
                    <p className="text-blue-100 font-medium">{m.desc}</p>
                  </div>
                  <div className="absolute -right-4 -bottom-4 text-8xl opacity-10 group-hover:rotate-12 transition-transform">
                    {m.emoji}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <motion.div
              key="question"
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              className="w-full flex flex-col items-center"
            >
              {/* Question Progress */}
              <div className="w-full flex justify-between items-center mb-6 px-4">
                 <span className="text-sky-600 font-black">Question {currentIdx + 1} of 5</span>
                 <div className="flex-1 mx-4 h-4 bg-sky-200 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(currentIdx / 5) * 100}%` }}
                      className="h-full bg-sky-500"
                    />
                 </div>
              </div>

              {/* Sparky & Question */}
              <div className="w-full flex flex-col md:flex-row gap-8 items-center bg-white p-8 rounded-[3rem] shadow-xl border-4 border-sky-100 relative mb-12">
                 <motion.div
                   animate={{ y: [0, -10, 0] }}
                   transition={{ repeat: Infinity, duration: 2 }}
                   className="text-8xl shrink-0"
                 >
                   ✨🚀
                 </motion.div>
                 <div className="flex-1">
                   <div className="bg-sky-50 p-6 rounded-2xl relative mb-6 border-l-4 border-sky-400">
                     <p className="text-2xl font-bold text-sky-800 leading-relaxed">
                        {questions[currentIdx]?.text}
                     </p>
                     <div className="absolute -left-3 top-6 w-6 h-6 bg-sky-50 rotate-45 border-l-4 border-b-4 border-sky-400 border-opacity-0" />
                   </div>
                   
                   <div className="grid grid-cols-1 gap-4">
                     {questions[currentIdx]?.options.map((opt) => (
                       <button
                         key={opt}
                         onClick={() => handleAnswer(opt)}
                         className="bg-white border-4 border-sky-100 hover:border-sky-400 hover:bg-sky-50 text-sky-700 font-black py-4 px-6 rounded-2xl text-xl text-left transition-all active:scale-95 shadow-sm"
                       >
                         {opt}
                       </button>
                     ))}
                   </div>
                 </div>

                 {/* Feedback Overlay */}
                 <AnimatePresence>
                   {feedback && (
                     <motion.div
                       initial={{ opacity: 0, scale: 0.9 }}
                       animate={{ opacity: 1, scale: 1 }}
                       exit={{ opacity: 0, scale: 0.9 }}
                       className={`absolute inset-0 z-20 flex items-center justify-center p-8 rounded-[3rem] ${
                         feedback.type === 'correct' ? 'bg-green-500' : 'bg-orange-500'
                       } text-white text-center flex-col gap-4 shadow-inner`}
                     >
                       <div className="text-8xl">
                         {feedback.type === 'correct' ? '🌟' : '🤔'}
                       </div>
                       <p className="text-3xl font-black drop-shadow-md">{feedback.message}</p>
                       {feedback.type === 'hint' && (
                         <button
                           onClick={() => setFeedback(null)}
                           className="mt-4 bg-white text-orange-500 font-black px-8 py-3 rounded-2xl shadow-lg hover:scale-105 active:scale-95 transition-transform"
                         >
                           Try Again! 🚀
                         </button>
                       )}
                     </motion.div>
                   )}
                 </AnimatePresence>
              </div>
              
              <button 
                onClick={() => setProgress(prev => prev ? { ...prev, currentMission: null } : null)}
                className="text-sky-400 hover:text-sky-600 font-bold flex items-center gap-2 mt-4 transition-colors"
              >
                <RefreshCw size={20} /> Change Mission
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Decorative footer */}
      <footer className="mt-12 text-sky-300 flex items-center gap-4 text-xs font-bold uppercase tracking-widest">
        <span>Cloud World</span>
        <div className="flex gap-1">
           {[...Array(5)].map((_, i) => <Star key={i} size={8} fill="currentColor" />)}
        </div>
        <span>Sparky 2026</span>
      </footer>
    </div>
  );
}
