// Moderator guide: a self-contained, bilingual how-to for running the live
// event. Content is co-located here (a { vi, en } structure selected by the
// current language) rather than spread across dozens of flat i18n keys — the
// prose is long and reads better kept together. Only the tab label lives in
// i18n. A language toggle is included because the moderator console chrome
// doesn't carry one.
import { LangToggle, useI18n } from "../lib/i18n";
import { card } from "../lib/ui";

type Block =
  | { kind: "p"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "warn"; text: string }
  | { kind: "info"; text: string }
  | { kind: "tip"; text: string };

interface Section {
  id: string;
  icon: string;
  title: string;
  blocks: Block[];
}

interface GuideContent {
  intro: string;
  tocLabel: string;
  sections: Section[];
}

const CONTENT: Record<"vi" | "en", GuideContent> = {
  // ---------------------------------------------------------------------------
  // Tiếng Việt (nguồn chính)
  // ---------------------------------------------------------------------------
  vi: {
    intro:
      "Trang này hướng dẫn bạn vận hành sự kiện từ đầu đến cuối. Đọc lướt một lần trước sự kiện; trong lúc chạy, quay lại đây bất cứ khi nào cần.",
    tocLabel: "Mục lục",
    sections: [
      {
        id: "overview",
        icon: "🧭",
        title: "Tổng quan màn hình quản trị",
        blocks: [
          {
            kind: "p",
            text: "Thanh tab ở trên cùng chuyển giữa các màn hình. “Trực tiếp” nghĩa là dữ liệu tự cập nhật theo thời gian thực — nếu nghi ngờ, bấm “Làm mới”.",
          },
          {
            kind: "bullets",
            items: [
              "Bảng điều khiển — vận hành trực tiếp: check-in / check-out / gọi lượt.",
              "Tổng quan — số liệu trực tiếp của sự kiện.",
              "Đăng ký — danh sách tất cả người đăng ký, sửa thông tin.",
              "Quà tặng — tạo và theo dõi quà.",
              "Cấu hình — thiết lập trước sự kiện và nút Khởi động.",
              "Xuất dữ liệu — tải CSV kết quả.",
            ],
          },
          {
            kind: "info",
            text: "Mọi mốc giờ trong app đều theo giờ Việt Nam (UTC+7, định dạng 24 giờ), bất kể múi giờ thiết bị của bạn.",
          },
          {
            kind: "tip",
            text: "Bấm “Khóa” (góc phải trên) khi rời máy — quay lại cần nhập PIN. Nút EN/VI ở ngay dưới đầu trang này để đổi ngôn ngữ.",
          },
        ],
      },
      {
        id: "before",
        icon: "⚙️",
        title: "Trước sự kiện — tab Cấu hình",
        blocks: [
          {
            kind: "p",
            text: "Làm theo đúng thứ tự sau. Vài thiết lập sẽ bị khóa sau khi sự kiện bắt đầu.",
          },
          {
            kind: "steps",
            items: [
              "Đặt Số lượng máy. Chỉ đổi được trước khi bắt đầu VÀ khi chưa ai đăng ký — sau đó bị khóa.",
              "Thêm Thời lượng chạy cho phép (theo phút). Cần ít nhất một mục.",
              "Đặt Đệm (giây) — khoảng nghỉ giữa hai người trên cùng một máy.",
              "Đặt Thời gian bắt đầu sự kiện (giờ Việt Nam). Dùng đồng hồ trực tiếp hiển thị ngay trên trang.",
              "(Tùy chọn) Đặt Thời gian kết thúc — ai dự kiến hoàn thành sau giờ này sẽ vào danh sách chờ.",
              "Sang tab Quà tặng tạo các phần quà (tên + số lượng).",
              "Bấm “Khởi động sự kiện” — chốt thời gian dự kiến của từng người và khóa số máy. KHÔNG thể hoàn tác.",
            ],
          },
          {
            kind: "warn",
            text: "“Khởi động lại dữ liệu” (Khu vực nguy hiểm) XÓA toàn bộ người tham gia và kết quả rồi đưa sự kiện về chưa bắt đầu. Dùng nó để dọn dữ liệu THỬ trước sự kiện thật — máy, đệm, thời lượng, giờ bắt đầu và PIN được giữ nguyên.",
          },
        ],
      },
      {
        id: "board",
        icon: "🏃",
        title: "Trong sự kiện — tab Bảng điều khiển",
        blocks: [
          {
            kind: "p",
            text: "Mỗi máy một bảng riêng, chuyển bằng các tab máy. Chọn “Máy của tôi” để chỉ tập trung vào máy bạn đang phụ trách. Bảng cập nhật trực tiếp.",
          },
          {
            kind: "p",
            text: "Cách đồng hồ lượt chạy hoạt động:",
          },
          {
            kind: "bullets",
            items: [
              "Đồng hồ của mỗi lượt được neo vào thời điểm người trước check-out, đếm ngược (đệm + thời lượng chạy). Lượt đầu tiên neo vào giờ bắt đầu sự kiện.",
              "Trong phần đệm, bảng hiện “Khung giờ check-in” — thời gian người tiếp theo cần có mặt.",
              "Bấm “Gọi lượt tiếp” để mời/nhắc người kế tiếp lên máy.",
              "Check-in — chuyển trạng thái sang Đang chạy, tự ghi giờ bắt đầu (bạn không cần nhập). Bảng chuyển sang đếm ngược thời gian chạy.",
              "Vì đồng hồ neo vào check-out của người trước, ai check-in trễ sẽ còn ít thời gian hơn — hiển thị ngay trên đồng hồ.",
              "Tự động bắt đầu: nếu khung check-in về 0:00 mà chưa ai check-in, lượt tự chuyển sang đếm ngược (“Đang chạy (tự động)”) và nút Check-in biến mất — hành động tiếp theo là Check-out.",
              "Check-out — nhập Quãng đường (bắt buộc) và chọn quà HOẶC tích “Không tặng quà” (bắt buộc), tự ghi giờ kết thúc và chuyển sang lượt sau.",
              "Vắng mặt / Bỏ qua — chuyển sang người kế tiếp. KHÔNG cân bằng lại, KHÔNG tính lại dự kiến của ai.",
              "Hoàn tác — đảo ngược một lần check-in / check-out vừa thực hiện nếu lỡ tay.",
            ],
          },
        ],
      },
      {
        id: "gifts",
        icon: "🎁",
        title: "Quà tặng khi check-out",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Bắt buộc chọn quà hoặc tích “Không tặng quà” — nút Xác nhận sẽ không cho qua nếu chưa chọn, để không bao giờ quên trao quà.",
              "Một người (theo email) chỉ nhận quà MỘT lần. Nếu email đó đã nhận quà ở lượt khác, ô chọn quà sẽ tự khóa về “Không tặng quà”.",
              "Tab Quà tặng: tạo / sửa / xóa quà và theo dõi số Còn lại / Tổng.",
              "Bảng “Quà theo mức thời gian” xếp hạng người hoàn thành theo từng mức thời lượng — N người đầu tiên ở mỗi mức nhận quà tương ứng.",
            ],
          },
        ],
      },
      {
        id: "registration",
        icon: "📝",
        title: "tab Đăng ký",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Danh sách tìm kiếm được mọi người đăng ký (theo tên hoặc email).",
              "Sửa được họ tên, khối/phòng, email và thời lượng. Email chỉ bị từ chối nếu trùng với một đăng ký đang hoạt động khác.",
              "Máy được cố định và chỉ hiển thị — KHÔNG đổi máy của một người ở đây.",
            ],
          },
        ],
      },
      {
        id: "idle",
        icon: "⚠️",
        title: "Máy rảnh — quy tắc quan trọng nhất",
        blocks: [
          {
            kind: "warn",
            text: "Hệ thống KHÔNG BAO GIỜ tự cân bằng lại. Mỗi người được gán một máy lúc đăng ký và giữ nguyên máy đó suốt sự kiện.",
          },
          {
            kind: "bullets",
            items: [
              "Hệ quả: một máy gặp nhiều ca vắng mặt hoặc người chạy nhanh có thể xong sớm và ngồi rảnh, trong khi máy khác vẫn còn hàng dài.",
              "Đây là CHỦ Ý: ai cũng giữ đúng máy và khung giờ đã được hứa lúc đăng ký; không ai bị đẩy lùi vì hàng người khác.",
              "Bạn là van an toàn thủ công: theo dõi đồng hồ lượt trên Bảng. Nếu một máy rảnh mà người kế tiếp chưa tới, hãy hối họ check-in để không lãng phí máy.",
              "Khi một máy đã xong và đang rảnh, Bảng hiện cảnh báo. Bạn CÓ THỂ chuyển một người ĐANG CHỜ (chưa check-in) từ máy khác sang máy ĐANG TRỐNG bằng nút “Chuyển máy…”. Không bao giờ chuyển người đã bắt đầu chạy.",
            ],
          },
        ],
      },
      {
        id: "dashboard",
        icon: "📊",
        title: "tab Tổng quan",
        blocks: [
          {
            kind: "p",
            text: "Số liệu trực tiếp của sự kiện: lượt đăng ký, tỉ lệ hoàn thành, tỉ lệ vắng/bỏ, số đang chạy, danh sách chờ, hiệu suất máy, tổng/trung bình/cao nhất quãng đường, quà đã trao, và nhật ký hoạt động gần đây của quản trị viên.",
          },
        ],
      },
      {
        id: "export",
        icon: "⬇️",
        title: "tab Xuất dữ liệu",
        blocks: [
          {
            kind: "p",
            text: "Một cú bấm tải về CSV (UTF-8) của mọi người tham gia và kết quả: họ tên, khối/phòng, email, máy, thời lượng, dự kiến ban đầu, giờ bắt đầu/kết thúc thực tế, quãng đường, quà, trạng thái. Làm bước này khi kết thúc sự kiện.",
          },
        ],
      },
      {
        id: "rules",
        icon: "✅",
        title: "Nguyên tắc vàng",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Việc gán máy là vĩnh viễn — không bao giờ chuyển người đã bắt đầu chạy.",
              "Hệ thống không tự cân bằng — bạn là van an toàn, hãy để mắt tới máy rảnh.",
              "Check-out luôn cần Quãng đường + quyết định về quà.",
              "Mỗi email chỉ nhận quà một lần.",
              "Mọi giờ đều theo giờ Việt Nam (UTC+7).",
              "Bấm “Khóa” khi rời máy.",
            ],
          },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // English
  // ---------------------------------------------------------------------------
  en: {
    intro:
      "This page walks you through running the event end to end. Skim it once before the event; during the event, come back here whenever you need it.",
    tocLabel: "On this page",
    sections: [
      {
        id: "overview",
        icon: "🧭",
        title: "The moderator console at a glance",
        blocks: [
          {
            kind: "p",
            text: "The top tab bar switches screens. “Live” means data updates in real time — if in doubt, press “Refresh”.",
          },
          {
            kind: "bullets",
            items: [
              "Board — live ops: check in / check out / call the next runner.",
              "Dashboard — live event metrics.",
              "Registration — the full list of sign-ups; edit details.",
              "Gifts — create and track gifts.",
              "Config — pre-event setup and the Start button.",
              "Export — download the results CSV.",
            ],
          },
          {
            kind: "info",
            text: "Every time shown in the app is Vietnam time (UTC+7, 24-hour), regardless of your device's timezone.",
          },
          {
            kind: "tip",
            text: "Press “Lock” (top right) when you step away — returning needs the PIN. The EN/VI toggle just below the heading switches language.",
          },
        ],
      },
      {
        id: "before",
        icon: "⚙️",
        title: "Before the event — Config tab",
        blocks: [
          {
            kind: "p",
            text: "Do these in order. A few settings lock once the event starts.",
          },
          {
            kind: "steps",
            items: [
              "Set the Number of machines. Changeable only before the event starts AND before anyone signs up — locked afterward.",
              "Add the Allowed run durations (in minutes). At least one is required.",
              "Set the Buffer (seconds) — the gap between two runners on the same machine.",
              "Set the Event start time (Vietnam time). Use the live clock shown right on the page.",
              "(Optional) Set the Event end time — anyone projected to finish after it goes to the waitlist.",
              "Go to the Gifts tab and create the gifts (name + quantity).",
              "Press “Start event” — this freezes everyone's original estimate and locks the machine count. It CANNOT be undone.",
            ],
          },
          {
            kind: "warn",
            text: "“Restart event data” (Danger zone) DELETES all participants and results and un-starts the event. Use it to clear TEST data before the real event — machines, buffer, durations, start time and PINs are kept.",
          },
        ],
      },
      {
        id: "board",
        icon: "🏃",
        title: "During the event — Board tab",
        blocks: [
          {
            kind: "p",
            text: "One panel per machine, switched with the machine tabs. Pick “My station” to focus on just the machine you're running. The board updates live.",
          },
          {
            kind: "p",
            text: "How the slot timer works:",
          },
          {
            kind: "bullets",
            items: [
              "Each runner's timer is anchored to when the previous runner checked out, counting down (buffer + run duration). The very first runner is anchored to the event start time.",
              "During the buffer, the board shows a “Check-in window” — the time the next runner is expected to arrive.",
              "Press “Call next” to summon the next runner up to the machine.",
              "Check in — sets the runner to Running and auto-stamps the start time (you never type it). The board switches to a run countdown.",
              "Because the slot is anchored to the previous check-out, a late check-in has less time left — shown right on the timer.",
              "Auto-start: if the check-in window hits 0:00 with no check-in, the slot rolls into the run countdown (“Running (auto-started)”) and the Check-in button disappears — the next action is Check out.",
              "Check out — enter Distance (required) and pick a gift OR tick “No gift” (required); finish time is auto-stamped and the queue advances.",
              "No-show / Skip — advances to the next runner. No rebalancing, no recompute of anyone's estimate.",
              "Undo — reverses a check-in / check-out you just did, if you slipped.",
            ],
          },
        ],
      },
      {
        id: "gifts",
        icon: "🎁",
        title: "Gifts at check-out",
        blocks: [
          {
            kind: "bullets",
            items: [
              "You must pick a gift or tick “No gift” — Confirm won't proceed otherwise, so a gift is never skipped by accident.",
              "One gift per email. If that email already received a gift on another run, the picker locks to “No gift”.",
              "Gifts tab: create / edit / delete gifts and watch Remaining / Total.",
              "The “Gifts by duration tier” panel ranks finishers within each duration tier — the first N finishers in each tier get the matching gift.",
            ],
          },
        ],
      },
      {
        id: "registration",
        icon: "📝",
        title: "Registration tab",
        blocks: [
          {
            kind: "bullets",
            items: [
              "A searchable list of every sign-up (by name or email).",
              "Edit name, domain, email and duration. An email is rejected only if it clashes with another active registration.",
              "The machine is fixed and read-only — you cannot move someone to another machine here.",
            ],
          },
        ],
      },
      {
        id: "idle",
        icon: "⚠️",
        title: "Idle machines — the most important rule",
        blocks: [
          {
            kind: "warn",
            text: "The system NEVER rebalances. Each runner is assigned a machine at sign-up and keeps that exact machine for the whole event.",
          },
          {
            kind: "bullets",
            items: [
              "Consequence: a machine with several no-shows or fast finishers can finish early and sit idle while another machine still has a long line.",
              "This is INTENTIONAL: everyone keeps the exact machine and time window promised at sign-up; nobody is pushed later because someone else's queue moved.",
              "You are the manual safety valve: watch the slot timers on the Board. If a machine is idle and its next runner hasn't appeared, hustle them to check in so the machine isn't wasted.",
              "When a machine has finished and is idle, the Board shows a warning. You MAY move a WAITING runner (not yet checked in) from another machine onto the FREE machine via the “Move to…” button. Never move a runner who has already started.",
            ],
          },
        ],
      },
      {
        id: "dashboard",
        icon: "📊",
        title: "Dashboard tab",
        blocks: [
          {
            kind: "p",
            text: "Live event metrics: sign-ups, completion rate, no-show/skip rate, runners running now, waitlisted, machine use, total/average/best distance, gifts awarded, and a recent moderator-activity feed.",
          },
        ],
      },
      {
        id: "export",
        icon: "⬇️",
        title: "Export tab",
        blocks: [
          {
            kind: "p",
            text: "One click downloads a CSV (UTF-8) of every participant and result: name, domain, email, machine, duration, original estimate, actual start/finish, distance, gift, status. Do this at the end of the event.",
          },
        ],
      },
      {
        id: "rules",
        icon: "✅",
        title: "Golden rules",
        blocks: [
          {
            kind: "bullets",
            items: [
              "Assignment is permanent — never move a runner who has started.",
              "The system never rebalances — you're the safety valve; keep an eye on idle machines.",
              "Check-out always needs Distance + a gift decision.",
              "One gift per email.",
              "All times are Vietnam time (UTC+7).",
              "Press “Lock” when you step away.",
            ],
          },
        ],
      },
    ],
  },
};

function Callout({ tone, text }: { tone: "warn" | "info" | "tip"; text: string }) {
  const styles: Record<string, string> = {
    warn: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
    tip: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  const icon: Record<string, string> = { warn: "⚠️", info: "ℹ️", tip: "💡" };
  return (
    <div className={`flex gap-2 rounded-xl border px-3 py-2 text-sm ${styles[tone]}`}>
      <span aria-hidden>{icon[tone]}</span>
      <span>{text}</span>
    </div>
  );
}

function renderBlock(block: Block, i: number) {
  switch (block.kind) {
    case "p":
      return (
        <p key={i} className="text-sm leading-relaxed text-slate-700">
          {block.text}
        </p>
      );
    case "steps":
      return (
        <ol key={i} className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 marker:font-semibold marker:text-brand">
          {block.items.map((it, j) => (
            <li key={j}>{it}</li>
          ))}
        </ol>
      );
    case "bullets":
      return (
        <ul key={i} className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700 marker:text-brand">
          {block.items.map((it, j) => (
            <li key={j}>{it}</li>
          ))}
        </ul>
      );
    case "warn":
    case "info":
    case "tip":
      return <Callout key={i} tone={block.kind} text={block.text} />;
  }
}

export default function GuideView() {
  const { lang } = useI18n();
  const content = CONTENT[lang];

  return (
    <div className="space-y-6">
      {/* Header + language toggle (the console chrome doesn't carry one). */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand">
              {lang === "vi" ? "Hướng dẫn cho người điều phối" : "Moderator guide"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600">
              {content.intro}
            </p>
          </div>
          <LangToggle />
        </div>

        {/* Quick jump links. */}
        <nav className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {content.tocLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            {content.sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-brand hover:text-white"
              >
                <span aria-hidden>{s.icon}</span> {s.title}
              </a>
            ))}
          </div>
        </nav>
      </div>

      {content.sections.map((s) => (
        <section key={s.id} id={s.id} className={`scroll-mt-24 ${card}`}>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-brand">
            <span aria-hidden>{s.icon}</span>
            {s.title}
          </h2>
          <div className="mt-3 space-y-3">{s.blocks.map(renderBlock)}</div>
        </section>
      ))}
    </div>
  );
}
