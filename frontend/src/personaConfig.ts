import humorousImage from "./assets/personas/humorous.png";
import seriousImage from "./assets/personas/serious.png";
import empatheticImage from "./assets/personas/empathetic.png";
import motivatingImage from "./assets/personas/motivating.png";
import thoughtfulImage from "./assets/personas/thoughtful.png";

export type IntroLanguage = "en" | "vi";
export type PersonaGender = "male" | "female";
export type PersonaPauseProfile = "short" | "medium" | "long" | "medium-long";

export type PersonaVoiceProfile = {
  gender: PersonaGender;
  kokoroVoice: string;
  style: string;
  preferredRate: number;
  preferredPitch: number;
  preferredVolume: number;
  pauseProfile: PersonaPauseProfile;
  nameHints: string[];
};

type LocalizedPersonaCopy = {
  tag: string;
  description: string;
};

export const personaVisuals = {
  humorous: {
    image: humorousImage,
    accent: "#ff8a65",
    voice: { gender: "male", kokoroVoice: "am_eric", style: "Warm, friendly, light, energetic", preferredRate: 1.05, preferredPitch: 1.07, preferredVolume: 1, pauseProfile: "short", nameHints: ["david", "guy", "alex", "mark"] },
    copy: {
      en: {
        tag: "LIGHT & PLAYFUL",
        description: "A quick-witted friend who keeps every conversation light, natural, and full of little laughs.",
      },
      vi: {
        tag: "VUI VẺ & HÀI HƯỚC",
        description: "Một người bạn nhanh trí, vui tính, giúp cuộc trò chuyện luôn nhẹ nhàng, tự nhiên và có thêm những tiếng cười.",
      },
    },
  },
  serious: {
    image: seriousImage,
    accent: "#6ea8fe",
    voice: { gender: "male", kokoroVoice: "am_michael", style: "Calm, clear, grounded, mature", preferredRate: 0.95, preferredPitch: 0.97, preferredVolume: 0.96, pauseProfile: "medium", nameHints: ["daniel", "george", "james", "david"] },
    copy: {
      en: {
        tag: "CLEAR & GROUNDED",
        description: "A calm, thoughtful friend for clear conversations that feel focused, mature, and grounded.",
      },
      vi: {
        tag: "ĐIỀM TĨNH & CHÍN CHẮN",
        description: "Một người bạn bình tĩnh và sâu sắc, phù hợp cho những cuộc trò chuyện rõ ràng, nghiêm túc và trưởng thành.",
      },
    },
  },
  empathetic: {
    image: empatheticImage,
    accent: "#f28db4",
    voice: { gender: "female", kokoroVoice: "af_sarah", style: "Warm, soft, gentle, comforting", preferredRate: 0.92, preferredPitch: 1.02, preferredVolume: 0.92, pauseProfile: "long", nameHints: ["samantha", "zira", "susan", "ava", "jenny"] },
    copy: {
      en: {
        tag: "WARM & UNDERSTANDING",
        description: "A patient friend who listens closely and gives you room to share what is on your mind.",
      },
      vi: {
        tag: "ẤM ÁP & THẤU HIỂU",
        description: "Một người bạn kiên nhẫn, sẵn sàng lắng nghe và cho bạn không gian để chia sẻ những điều đang chất chứa.",
      },
    },
  },
  motivating: {
    image: motivatingImage,
    accent: "#6ddbc4",
    voice: { gender: "female", kokoroVoice: "af_bella", style: "Bright, clear, positive, energetic", preferredRate: 1.04, preferredPitch: 1.07, preferredVolume: 0.99, pauseProfile: "short", nameHints: ["jenny", "aria", "emma", "samantha", "zira"] },
    copy: {
      en: {
        tag: "BRIGHT & ENCOURAGING",
        description: "An uplifting friend who helps you find momentum without making the conversation feel like a lesson.",
      },
      vi: {
        tag: "TÍCH CỰC & KHÍCH LỆ",
        description: "Một người bạn tràn đầy năng lượng, giúp bạn tìm lại động lực mà không khiến cuộc trò chuyện giống một buổi học.",
      },
    },
  },
  thoughtful: {
    image: thoughtfulImage,
    accent: "#a78bfa",
    voice: { gender: "male", kokoroVoice: "am_adam", style: "Calm, reflective, soft, measured", preferredRate: 0.92, preferredPitch: 0.98, preferredVolume: 0.95, pauseProfile: "medium-long", nameHints: ["daniel", "alex", "george", "david", "james"] },
    copy: {
      en: {
        tag: "CURIOUS & DEEP",
        description: "A curious friend who asks open questions and explores the ideas beneath everyday conversation.",
      },
      vi: {
        tag: "SÂU SẮC & TÒ MÒ",
        description: "Một người bạn thích đặt những câu hỏi mở và cùng bạn khám phá những suy nghĩ, quan điểm sâu hơn.",
      },
    },
  },
} satisfies Record<string, { image: string; accent: string; voice: PersonaVoiceProfile; copy: Record<IntroLanguage, LocalizedPersonaCopy> }>;

export const introCopy = {
  en: {
    status: "Your private English space",
    kicker: "Choose your conversation energy",
    headline: { first: "Meet the friend", second: "you feel like talking to." },
    description: { first: "Every friend brings a different rhythm, point of view, and kind of support.", second: "Pick one to start a conversation that feels like yours." },
    newFriend: "New friend",
    yourFriend: "Your friend",
    start: "Start conversation",
    continue: "Continue conversation",
    opening: "Opening...",
    footerLeft: "One conversation at a time.",
    footerRight: "Always in your corner.",
    friendsLabel: "AI friends",
    loadingLabel: "Loading AI friends",
    errorTitle: "We couldn’t bring your friends online.",
  },
  vi: {
    status: "Không gian tiếng Anh riêng của bạn",
    kicker: "Chọn năng lượng trò chuyện của bạn",
    headline: { first: "Chọn người bạn", second: "bạn muốn trò chuyện cùng." },
    description: { first: "Mỗi người bạn mang một tính cách, góc nhìn và cách đồng hành khác nhau.", second: "Hãy chọn người phù hợp với cảm xúc của bạn lúc này." },
    newFriend: "Người bạn mới",
    yourFriend: "Bạn đồng hành",
    start: "Bắt đầu trò chuyện",
    continue: "Tiếp tục trò chuyện",
    opening: "Đang mở...",
    footerLeft: "Mỗi lần một cuộc trò chuyện.",
    footerRight: "Luôn ở bên bạn.",
    friendsLabel: "Những người bạn AI",
    loadingLabel: "Đang tải những người bạn AI",
    errorTitle: "Không thể kết nối với những người bạn của bạn.",
  },
} as const;

export function getPersonaCopy(slug: string, language: IntroLanguage): LocalizedPersonaCopy | null {
  return personaVisuals[slug as keyof typeof personaVisuals]?.copy[language] || null;
}

export function getPersonaVoiceProfile(slug: string): PersonaVoiceProfile {
  return personaVisuals[slug as keyof typeof personaVisuals]?.voice || personaVisuals.thoughtful.voice;
}
