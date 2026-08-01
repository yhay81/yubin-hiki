import { Hono } from "hono";
import type { Context } from "hono";
import { requestId } from "hono/request-id";

import meta from "./generated/postal-meta.json";
import {
  formatPostalCode,
  normalizeSearch,
  postalCodePattern,
  PREFECTURES,
  type PostalRow,
} from "./domain/postal";

export type Bindings = { ASSETS: Fetcher; DB: D1Database };
type Variables = { requestId: string };
type AppContext = Context<{ Bindings: Bindings; Variables: Variables }>;

class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: 400 | 403 | 404 | 413 | 415,
  ) {
    super(code);
  }
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const canonicalOrigin = "https://yubin-hiki.yhay81.com";
const sessionPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const telemetryNames = new Set([
  "visited",
  "searched",
  "no_result",
  "postal_opened",
  "postal_copied",
  "address_copied",
  "saved",
  "returned",
]);
const rowColumns =
  "id,postal_code,prefecture,city,town,address,prefecture_kana,city_kana,town_kana,kana_address";
const nowSeconds = () => Math.floor(Date.now() / 1000);

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const enforceSameOrigin = (c: AppContext) => {
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") throw new ApiError("cross_site_request", 403);
  const origin = c.req.header("origin");
  if (origin && origin !== new URL(c.req.url).origin) throw new ApiError("cross_site_request", 403);
};

const parseJson = async (c: AppContext, maximumBytes = 1024) => {
  if (!(c.req.header("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new ApiError("unsupported_media_type", 415);
  }
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    throw new ApiError("payload_too_large", 413);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ApiError("invalid_json", 400);
  }
};

const objectPayload = (payload: unknown) => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiError("invalid_request", 400);
  }
  return payload as Record<string, unknown>;
};

const recordEvent = async (c: AppContext, name: string) => {
  const session = (c.req.header("x-yubin-session") ?? "").toLowerCase();
  if (!sessionPattern.test(session)) return;
  await c.env.DB.prepare(
    "INSERT INTO product_events (session_hash,event_name,is_qa,created_at) VALUES (?,?,?,?)",
  )
    .bind(await sha256(session), name, c.req.header("x-yubin-qa") === "1" ? 1 : 0, nowSeconds())
    .run();
};

const searchRows = async (c: AppContext, q: string, prefecture = "") => {
  const search = normalizeSearch({ q, prefecture });
  if (!search.query || (search.kind === "address" && search.query.length < 2)) {
    throw new ApiError("query_too_short", 400);
  }

  const clauses: string[] = [];
  const values: string[] = [];
  if (search.prefecture) {
    clauses.push("prefecture = ?");
    values.push(search.prefecture);
  }
  if (search.kind === "postal") {
    clauses.push(search.query.length === 7 ? "postal_code = ?" : "postal_code LIKE ?");
    values.push(search.query.length === 7 ? search.query : `${search.query}%`);
  } else {
    for (const token of search.tokens) {
      clauses.push("(instr(address, ?) > 0 OR instr(kana_address, ?) > 0)");
      values.push(token, token);
    }
  }

  let ordering = "postal_code,address";
  if (search.kind === "address") {
    const compact = search.tokens.join("");
    const local =
      search.prefecture && compact.startsWith(search.prefecture)
        ? compact.slice(search.prefecture.length)
        : compact;
    const town = search.tokens.at(-1) ?? local;
    ordering =
      "CASE WHEN address = ? OR kana_address = ? THEN 0 WHEN city_town = ? OR kana_city_town = ? THEN 1 WHEN town = ? OR town_kana = ? THEN 2 ELSE 3 END,postal_code,address";
    values.push(compact, compact, local, local, town, town);
  }

  const result = await c.env.DB.prepare(
    `SELECT ${rowColumns} FROM postal_entries WHERE ${clauses.join(" AND ")} ORDER BY ${ordering} LIMIT 31`,
  )
    .bind(...values)
    .all<PostalRow>();
  const rows = result.results ?? [];
  return { hasMore: rows.length > 30, results: rows.slice(0, 30) };
};

const Layout = ({
  canonical,
  children,
  description,
  noindex = false,
  title,
}: {
  canonical: string;
  children: unknown;
  description: string;
  noindex?: boolean;
  title: string;
}) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta content="width=device-width,initial-scale=1" name="viewport" />
      <title>{title}</title>
      <meta content={description} name="description" />
      {noindex ? <meta content="noindex,nofollow" name="robots" /> : null}
      <link href={canonical} rel="canonical" />
      <meta content="website" property="og:type" />
      <meta content="郵便引き" property="og:site_name" />
      <meta content={title} property="og:title" />
      <meta content={description} property="og:description" />
      <meta content={canonical} property="og:url" />
      <meta content={`${canonicalOrigin}/og.svg`} property="og:image" />
      <meta content="summary_large_image" name="twitter:card" />
      <meta content="#f3efe3" name="theme-color" />
      <link href="/favicon.svg" rel="icon" type="image/svg+xml" />
      <link href="/manifest.webmanifest" rel="manifest" />
      <link href="/styles.css" rel="stylesheet" />
      <script defer src="/app.js" />
    </head>
    <body>
      <a class="skip-link" href="#main">
        本文へ
      </a>
      <header class="site-header">
        <a aria-label="郵便引き ホーム" class="wordmark" href="/">
          <span aria-hidden="true">〒</span>
          <b>郵便引き</b>
        </a>
        <nav aria-label="サイト案内">
          <a href="/guide">使い方</a>
          <a href="/source">データ</a>
          <a href="/privacy">取扱い</a>
        </nav>
      </header>
      {children}
      <footer class="site-footer">
        <span>〒 郵便引き</span>
        <span>日本郵便の郵便番号データから作成</span>
        <a href="https://github.com/yhay81/yubin-hiki">GitHub</a>
      </footer>
    </body>
  </html>
);

const PostalBoxes = () => (
  <div aria-hidden="true" class="postal-boxes">
    {[0, 1, 2].map((value) => (
      <i data-slot={value} />
    ))}
    <span>−</span>
    {[3, 4, 5, 6].map((value) => (
      <i data-slot={value} />
    ))}
  </div>
);

const Envelope = () => (
  <div aria-hidden="true" class="envelope">
    <div class="stamp">
      <span>〒</span>
      <i>JAPAN</i>
    </div>
    <PostalBoxes />
    <div class="address-lines">
      <span />
      <span />
      <span />
    </div>
    <div class="flap" />
  </div>
);

const SearchForm = () => (
  <form class="search-form" id="search-form" novalidate>
    <label for="query">郵便番号・住所・カナ</label>
    <div class="search-slot">
      <span aria-hidden="true">〒</span>
      <input
        autocomplete="postal-code"
        id="query"
        maxlength={80}
        name="q"
        placeholder="100-0001 / 千代田区千代田 / チヨダ"
        type="search"
      />
      <button type="submit">引く</button>
    </div>
    <div class="search-tools">
      <label>
        <span>都道府県</span>
        <select id="prefecture" name="prefecture">
          <option value="">全国</option>
          {PREFECTURES.map((prefecture) => (
            <option value={prefecture}>{prefecture}</option>
          ))}
        </select>
      </label>
      <div class="example-row" aria-label="検索例">
        <button data-example="1000001" type="button">
          100-0001
        </button>
        <button data-example="東京都千代田区千代田" type="button">
          千代田
        </button>
        <button data-example="ナハシ" type="button">
          ナハシ
        </button>
      </div>
    </div>
    <p class="search-status" id="search-status" role="status">
      番号から住所へ、住所から番号へ
    </p>
  </form>
);

const SavedTray = () => (
  <aside class="saved-tray" aria-labelledby="saved-heading">
    <div class="tray-tab">
      <span aria-hidden="true">控</span>
      <h2 id="saved-heading">宛先控え</h2>
      <b id="saved-count">0</b>
    </div>
    <div class="saved-stack" id="saved-stack">
      <p class="empty-tray">必要な宛先を、この端末だけに留めておけます。</p>
    </div>
    <button class="clear-button" hidden id="clear-saved" type="button">
      控えを空にする
    </button>
  </aside>
);

const HomePage = () => {
  const canonical = `${canonicalOrigin}/`;
  const description =
    "全国の郵便番号を番号、住所、カナから双方向に検索し、宛名書き用にコピーできる無料の郵便番号検索です。";
  return (
    <Layout
      canonical={canonical}
      description={description}
      title="郵便引き｜番号と住所を、どちらからでも"
    >
      <main class="home" id="main">
        <section class="lookup-board" aria-labelledby="product-title">
          <div class="lookup-heading">
            <p>番号と住所を、どちらからでも。</p>
            <h1 id="product-title">郵便引き</h1>
            <div class="data-seal">
              <b>{meta.unique_postal_codes.toLocaleString("ja-JP")}</b>
              <span>郵便番号</span>
              <time datetime={meta.data_updated_at}>
                {meta.data_updated_at.replaceAll("-", ".")} 更新
              </time>
            </div>
          </div>
          <Envelope />
          <SearchForm />
        </section>
        <div class="notice-strip">
          <span aria-hidden="true">〒</span>
          <p>町域名の「以下に掲載がない場合」など、元データの表記をそのまま表示します。</p>
          <a href="/source">収録内容</a>
        </div>
        <div class="work-area">
          <section class="results" aria-labelledby="results-heading">
            <div class="section-heading">
              <h2 id="results-heading">検索結果</h2>
              <span id="result-count">検索すると宛名票が並びます</span>
            </div>
            <div class="result-list" id="results">
              <div class="empty-result">
                <PostalBoxes />
                <p>郵便番号、漢字の住所、カナ住所のどれでも引けます。</p>
              </div>
            </div>
          </section>
          <SavedTray />
        </div>
      </main>
    </Layout>
  );
};

const PostalPage = ({ rows }: { rows: PostalRow[] }) => {
  const first = rows[0];
  const postal = formatPostalCode(first.postal_code);
  const canonical = `${canonicalOrigin}/zip/${first.postal_code}`;
  const description = `〒${postal} ${first.prefecture}${first.city}${first.town}。日本郵便の郵便番号データに基づく住所とカナ表記です。`;
  return (
    <Layout canonical={canonical} description={description} title={`〒${postal}の住所｜郵便引き`}>
      <main class="postal-page" id="main" data-open-postal>
        <a class="back-link" href="/">
          ← もう一度引く
        </a>
        <article class="address-sheet">
          <header>
            <span class="sheet-mark">〒</span>
            <div class="sheet-code" aria-label={`郵便番号 ${postal}`}>
              {first.postal_code.split("").map((digit, index) => (
                <span class={index === 3 ? "break" : ""}>{digit}</span>
              ))}
            </div>
          </header>
          <div class="sheet-addresses">
            {rows.map((row) => (
              <section>
                <p>{row.prefecture_kana + row.city_kana + row.town_kana}</p>
                <h1>{row.address}</h1>
                <div class="sheet-actions">
                  <button data-copy-postal={postal} type="button">
                    郵便番号をコピー
                  </button>
                  <button data-copy-address={row.address} type="button">
                    住所をコピー
                  </button>
                  <button
                    data-save-address
                    data-postal={first.postal_code}
                    data-address={row.address}
                    data-kana={row.kana_address}
                    type="button"
                  >
                    宛先控えへ
                  </button>
                </div>
              </section>
            ))}
          </div>
        </article>
        <section class="source-note">
          <b>日本郵便データ {meta.data_updated_at.replaceAll("-", ".")}</b>
          <p>
            番地・建物名は含まれません。郵便物を出す前に、相手から案内された住所も確認してください。
          </p>
        </section>
      </main>
    </Layout>
  );
};

const GuidePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/guide`}
    description="郵便引きで郵便番号、漢字の住所、カナ住所から宛先を探し、コピーや端末内保存を行う方法。"
    title="使い方｜郵便引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span aria-hidden="true">〒</span>
        <h1>使い方</h1>
      </header>
      <div class="instruction-grid">
        <section>
          <b>1</b>
          <h2>わかる方を入れる</h2>
          <p>「100-0001」のような番号でも、「千代田区千代田」のような住所でも探せます。</p>
        </section>
        <section>
          <b>2</b>
          <h2>宛名票を選ぶ</h2>
          <p>同じ郵便番号に複数の町域がある場合は、候補を分けて表示します。</p>
        </section>
        <section>
          <b>3</b>
          <h2>写すか控える</h2>
          <p>番号と住所を別々にコピーできます。控えはこのブラウザだけに残ります。</p>
        </section>
      </div>
      <a class="page-cta" href="/">
        郵便番号を引く
      </a>
    </main>
  </Layout>
);

const SourcePage = () => (
  <Layout
    canonical={`${canonicalOrigin}/source`}
    description="郵便引きが使用する日本郵便の郵便番号データ、更新日、収録範囲と注意点。"
    title="データ｜郵便引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span aria-hidden="true">〒</span>
        <h1>データ</h1>
      </header>
      <div class="source-grid">
        <section class="source-ledger">
          <h2>現在の収録</h2>
          <dl>
            <div>
              <dt>郵便番号</dt>
              <dd>{meta.unique_postal_codes.toLocaleString("ja-JP")}件</dd>
            </div>
            <div>
              <dt>町域行</dt>
              <dd>{meta.rows.toLocaleString("ja-JP")}件</dd>
            </div>
            <div>
              <dt>都道府県</dt>
              <dd>{meta.prefectures}件</dd>
            </div>
            <div>
              <dt>更新日</dt>
              <dd>{meta.data_updated_at}</dd>
            </div>
          </dl>
          <a
            href="https://www.post.japanpost.jp/service/search/zipcode/download/utf-zip.html"
            rel="noopener noreferrer"
          >
            日本郵便の配布ページ
          </a>
        </section>
        <section>
          <h2>収録しているもの</h2>
          <p>
            日本郵便「住所の郵便番号（1レコード1郵便番号形式・UTF-8）」の全国一括データを使っています。
          </p>
          <p>町域、読み仮名、変更表示を取り込み、検索しやすい形に整えています。</p>
        </section>
        <section>
          <h2>含まれないもの</h2>
          <p>事業所の個別郵便番号、デジタルアドレス、番地、建物名は初期版の対象外です。</p>
          <p>郵便番号の変更直後などは、データ更新まで差が出ることがあります。</p>
        </section>
        <section>
          <h2>運営について</h2>
          <p>
            個人が運営する非公式サービスです。日本郵便株式会社による提供、監修、推奨を受けたものではありません。
          </p>
        </section>
      </div>
    </main>
  </Layout>
);

const PrivacyPage = () => (
  <Layout
    canonical={`${canonicalOrigin}/privacy`}
    description="郵便引きの検索語、宛先控え、最小限の利用計測の取扱い。"
    title="取扱い｜郵便引き"
  >
    <main class="content-page" id="main">
      <header class="content-heading">
        <span aria-hidden="true">〒</span>
        <h1>取扱い</h1>
      </header>
      <div class="privacy-grid">
        <section>
          <h2>検索内容</h2>
          <p>郵便番号や住所はPOSTで検索に使い、URL、データベース、利用計測へ保存しません。</p>
        </section>
        <section>
          <h2>宛先控え</h2>
          <p>
            保存した宛先は、このブラウザのlocalStorageだけに最大60件残ります。アカウントやCookieは使いません。
          </p>
        </section>
        <section>
          <h2>利用計測</h2>
          <p>
            ランダムな端末IDのハッシュ、操作名、時刻だけを35日間保存します。郵便番号や住所、外部解析、広告識別子は含みません。
          </p>
        </section>
        <section>
          <h2>通信</h2>
          <p>
            サービス運用上のアクセスログは配信基盤に残る場合があります。入力内容をURLへ含めないことで露出を抑えています。
          </p>
        </section>
      </div>
    </main>
  </Layout>
);

app.use("*", requestId());
app.use("*", async (c, next) => {
  await next();
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; upgrade-insecure-requests",
  );
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Resource-Policy", "same-origin");
  c.header("Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-Request-Id", c.get("requestId"));
});

app.get("/", (c) => {
  c.header("Cache-Control", "public,max-age=60,s-maxage=300");
  return c.html(<HomePage />);
});
app.get("/guide", (c) => c.html(<GuidePage />));
app.get("/source", (c) => c.html(<SourcePage />));
app.get("/privacy", (c) => c.html(<PrivacyPage />));
app.get("/zip/:postal", async (c) => {
  const postal = c.req.param("postal");
  if (!postalCodePattern.test(postal)) return c.notFound();
  const result = await c.env.DB.prepare(
    `SELECT ${rowColumns} FROM postal_entries WHERE postal_code = ? ORDER BY address`,
  )
    .bind(postal)
    .all<PostalRow>();
  if (!result.results?.length) return c.notFound();
  c.header("Cache-Control", "public,max-age=300,s-maxage=86400");
  return c.html(<PostalPage rows={result.results} />);
});

app.post("/api/search", async (c) => {
  enforceSameOrigin(c);
  const payload = objectPayload(await parseJson(c));
  const q = typeof payload.q === "string" ? payload.q : "";
  const prefecture = typeof payload.prefecture === "string" ? payload.prefecture : "";
  const response = await searchRows(c, q, prefecture);
  await recordEvent(c, response.results.length ? "searched" : "no_result");
  c.header("Cache-Control", "no-store");
  return c.json(response);
});

app.post("/api/telemetry", async (c) => {
  enforceSameOrigin(c);
  const payload = objectPayload(await parseJson(c, 256));
  const name = typeof payload.name === "string" ? payload.name : "";
  if (!telemetryNames.has(name)) throw new ApiError("invalid_event", 400);
  await recordEvent(c, name);
  return c.body(null, 202);
});

app.get("/health", async (c) => {
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS rows FROM postal_entries").first<{
    rows: number;
  }>();
  return c.json({
    dataUpdatedAt: meta.data_updated_at,
    expectedRows: meta.rows,
    ok: count?.rows === meta.rows,
    postalCodes: meta.unique_postal_codes,
    rows: count?.rows ?? 0,
    service: "yubin-hiki",
  });
});

app.notFound((c) => {
  c.status(404);
  return c.html(
    <Layout
      canonical={`${canonicalOrigin}/404`}
      description="指定された郵便番号は見つかりません。"
      noindex
      title="見つかりません｜郵便引き"
    >
      <main class="not-found" id="main">
        <Envelope />
        <h1>その宛先票は見つかりません</h1>
        <p>郵便番号を確かめて、もう一度検索してください。</p>
        <a href="/">郵便番号を引く</a>
      </main>
    </Layout>,
  );
});

app.onError((error, c) => {
  if (error instanceof ApiError)
    return c.json({ error: error.code, requestId: c.get("requestId") }, error.status);
  console.error(
    "request_failed",
    c.get("requestId"),
    error instanceof Error ? error.message : "unknown",
  );
  return c.json({ error: "internal_error", requestId: c.get("requestId") }, 500);
});

export const scheduled = async (_event: ScheduledEvent, env: Bindings, _ctx: ExecutionContext) => {
  await env.DB.prepare("DELETE FROM product_events WHERE created_at < ?")
    .bind(nowSeconds() - 35 * 86400)
    .run();
};

export { app };
export default { fetch: app.fetch, scheduled };
