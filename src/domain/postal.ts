export type SearchInput = {
  q: string;
  prefecture?: string;
};

export type NormalizedSearch = {
  kind: "address" | "postal";
  prefecture: string;
  query: string;
  tokens: string[];
};

export type PostalRow = {
  id: number;
  postal_code: string;
  prefecture: string;
  city: string;
  town: string;
  address: string;
  prefecture_kana: string;
  city_kana: string;
  town_kana: string;
  kana_address: string;
};

export const PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
] as const;

export const toKatakana = (value: string) =>
  value.replace(/[ぁ-ゖ]/gu, (letter) => String.fromCodePoint((letter.codePointAt(0) ?? 0) + 0x60));

export const normalizePostalCode = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[^0-9]/gu, "")
    .slice(0, 7);

export const formatPostalCode = (value: string) => {
  const digits = normalizePostalCode(value);
  return digits.length > 3 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : digits;
};

export const normalizeText = (value: string) =>
  toKatakana(value.normalize("NFKC"))
    .trim()
    .replace(/[\s　]+/gu, " ")
    .slice(0, 80);

export const normalizeSearch = (input: SearchInput): NormalizedSearch => {
  const raw = input.q.normalize("NFKC").trim();
  const digits = normalizePostalCode(raw);
  const looksPostal = /^[〒\d\s-]+$/u.test(raw) && digits.length >= 2;
  const prefecture = PREFECTURES.includes(input.prefecture as (typeof PREFECTURES)[number])
    ? (input.prefecture ?? "")
    : "";
  if (looksPostal) return { kind: "postal", prefecture, query: digits, tokens: [digits] };
  const query = normalizeText(raw);
  return {
    kind: "address",
    prefecture,
    query,
    tokens: query.split(" ").filter(Boolean).slice(0, 4),
  };
};

export const postalCodePattern = /^\d{7}$/u;
