// Lightweight i18n: a flat { vi, en } dictionary + a context/hook, no external
// dependency. Vietnamese is the DEFAULT language; the choice persists in
// localStorage. Strings support `{name}`-style interpolation.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type Lang = "vi" | "en";

const STORAGE_KEY = "energysteps.lang";

// ---------------------------------------------------------------------------
// Dictionary. Keep keys grouped by screen. `vi` is the source of truth for
// what users see by default; `en` mirrors it.
// ---------------------------------------------------------------------------
type Dict = Record<string, string>;

const vi: Dict = {
  "lang.vi": "Tiếng Việt",
  "lang.en": "English",

  // Common
  "common.refresh": "Làm mới",
  "common.cancel": "Hủy",
  "common.save": "Lưu",
  "common.saving": "Đang lưu…",
  "common.saved": "Đã lưu.",
  "common.loading": "Đang tải…",
  "common.edit": "Sửa",
  "common.delete": "Xóa",
  "common.add": "Thêm",
  "common.wrong": "Đã có lỗi xảy ra. Vui lòng thử lại.",

  // Error codes (raised by the RPCs)
  "error.EMAIL_TAKEN": "Email này đã đăng ký. Mỗi email chỉ được đăng ký một lần.",
  "error.INVALID_DURATION": "Thời lượng chạy không hợp lệ. Vui lòng chọn trong danh sách.",
  "error.INVALID_PIN": "Mã PIN không đúng.",
  "error.INVALID_EMAIL_DOMAIN": "Email phải kết thúc bằng @mblife.vn.",
  "error.QUEUE_COUNT_LOCKED": "Không thể đổi số lượng máy sau khi sự kiện đã bắt đầu.",
  "error.QUEUE_COUNT_HAS_SIGNUPS": "Không thể đổi số lượng máy khi đã có người đăng ký.",
  "error.ALREADY_STARTED": "Sự kiện đã được bắt đầu.",
  "error.NO_START_TIME": "Hãy đặt thời gian bắt đầu trước khi khởi động sự kiện.",
  "error.UNKNOWN": "Đã có lỗi xảy ra. Vui lòng thử lại.",

  // Sign-up page
  "signup.title": "EnergySteps — Đăng ký tham gia",
  "signup.subtitle": "Giữ chỗ của bạn, chọn thời lượng chạy, và chúng tôi sẽ xếp máy cho bạn.",
  "signup.name.label": "Họ và tên",
  "signup.name.placeholder": "Tên của bạn",
  "signup.domain.label": "Khối/Phòng",
  "signup.domain.placeholder": "Chọn khối/phòng…",
  "signup.email.label": "Email",
  "signup.email.placeholder": "ban@mblife.vn",
  "signup.email.mblife": "Email phải kết thúc bằng @mblife.vn.",
  "signup.duration.label": "Thời lượng chạy",
  "signup.duration.choose": "Vui lòng chọn thời lượng chạy.",
  "signup.submit": "Đăng ký",
  "signup.submitting": "Đang đăng ký…",
  "signup.checkStatus": "Kiểm tra trạng thái của tôi",
  "signup.loadError": "Hiện chưa tải được biểu mẫu đăng ký. Vui lòng thử lại.",
  "signup.retry": "Thử lại",
  "signup.loading": "Đang tải biểu mẫu đăng ký…",

  // Confirmation
  "confirm.done": "Bạn đã đăng ký thành công!",
  "confirm.machineLabel": "Máy được xếp cho bạn:",
  "confirm.machineNote": "Máy này là của bạn trong suốt sự kiện — sẽ không thay đổi.",
  "confirm.windowLabel": "Khung giờ check-in dự kiến",
  "confirm.noWindow": "Thời gian dự kiến sẽ có sau khi ban tổ chức đặt thời gian bắt đầu — hãy kiểm tra trang trạng thái sau.",
  "confirm.statusHint": "Bạn có thể quay lại bất cứ lúc nào để tra cứu trạng thái bằng email tại {link}.",
  "confirm.statusPage": "trang trạng thái",
  "confirm.again": "Đăng ký cho người khác",

  // Status page
  "status.title": "EnergySteps — Trạng thái của tôi",
  "status.subtitle": "Tra cứu vị trí xếp hàng và thời gian check-in dự kiến của bạn.",
  "status.email.label": "Email",
  "status.lookup": "Tra cứu",
  "status.lookingUp": "Đang tra cứu…",
  "status.notFound": "Không tìm thấy đăng ký cho email này.",
  "status.behind.tag": "Đang trễ tiến độ",
  "status.behind.headline": "Trễ khoảng {n} phút",
  "status.behind.newEta": "Thời gian check-in mới dự kiến là {time}",
  "status.onSchedule": "Đúng tiến độ",
  "status.onSchedule.eta": "Check-in dự kiến lúc {time}",
  "status.assignedMachine": "Máy được xếp",
  "status.originalEta": "Giờ bắt đầu dự kiến ban đầu",
  "status.setAtStart": "Đặt khi sự kiện bắt đầu",
  "status.currentEta": "Giờ bắt đầu dự kiến hiện tại",
  "status.position": "Vị trí trong hàng",
  "status.upNext": "Sắp tới",
  "status.statusLabel": "Trạng thái",
  "status.updated": "Cập nhật lúc {time}",
  "status.refreshing": "Đang làm mới…",
  "status.back": "← Quay lại đăng ký",
  "status.s.finished": "Bạn đã hoàn thành — tuyệt vời!",
  "status.s.skipped": "Lượt của bạn đã bị bỏ qua.",
  "status.s.no_show": "Được đánh dấu là vắng mặt.",
  "status.s.checked_in": "Bạn đã check-in — đến lượt bạn!",
  "status.s.signed_up": "Bạn đang trong hàng chờ.",

  // Statuses (shared labels)
  "st.signed_up": "Đã đăng ký",
  "st.checked_in": "Đang chạy",
  "st.finished": "Hoàn thành",
  "st.skipped": "Đã bỏ qua",
  "st.no_show": "Vắng mặt",

  // Moderator — layout / nav
  "mod.title": "EnergySteps · Quản trị",
  "mod.tab.board": "Bảng điều khiển",
  "mod.tab.registration": "Đăng ký",
  "mod.tab.gifts": "Quà tặng",
  "mod.tab.config": "Cấu hình",
  "mod.tab.export": "Xuất dữ liệu",
  "mod.live": "Trực tiếp",
  "mod.lock": "Khóa",

  // Moderator — board
  "board.loading": "Đang tải bảng điều khiển…",
  "board.noQueues": "Chưa có máy nào. Hãy đặt số lượng máy ở tab Cấu hình.",
  "board.complete": "Hoàn tất",
  "board.noStartTime": "Hãy đặt thời gian bắt đầu và Khởi động sự kiện ở tab Cấu hình.",
  "board.queueComplete": "✅ Hàng chờ hoàn tất — tất cả Amazers đã xong.",
  "board.awaitingCheckin": "Đang chờ check-in · vị trí {n}",
  "board.checkinWindow": "Khung giờ check-in",
  "board.autoStartNote": "Thời gian chạy tự động bắt đầu khi đồng hồ về 0:00.",
  "board.checkIn": "Check-in",
  "board.noShow": "Vắng mặt",
  "board.skip": "Bỏ qua",
  "board.running": "Đang chạy",
  "board.runningAuto": "Đang chạy (tự động)",
  "board.position": "vị trí {n}",
  "board.startedAt": "bắt đầu {time}",
  "board.autoRunningNote": "Khung check-in đã hết — đồng hồ đang chạy. Hãy check-out khi xong.",
  "board.runRemaining": "Thời gian chạy còn lại",
  "board.slotElapsed": "Hết thời gian — hãy check-out để chuyển lượt.",
  "board.checkOut": "Check-out",
  "board.checkOutTitle": "Check-out {name}",
  "board.distance": "Quãng đường (không bắt buộc)",
  "board.gift": "Quà tặng",
  "board.noGift": "Không có quà",
  "board.giftLeft": "{name} (còn {n})",
  "board.confirmCheckout": "Xác nhận check-out",
  "board.distanceNaN": "Quãng đường phải là số, hoặc để trống.",
  "board.confirmSkip": "Bạn có chắc muốn {verb} {name} không? Thao tác này chuyển lượt.",
  "board.verb.no_show": "đánh dấu vắng mặt",
  "board.verb.skipped": "bỏ qua",
  "board.upNext": "Sắp tới",
  "board.noMore": "Không còn Amazers nào trong hàng.",
  "board.doneCollapsed": "Hoàn thành & bỏ qua ({n})",
  "board.logged": "{n} đã ghi",
  "board.out": "ra {time}",

  // Moderator — registration (runners)
  "reg.loading": "Đang tải danh sách đăng ký…",
  "reg.search.label": "Tìm Amazers",
  "reg.search.placeholder": "Lọc theo tên hoặc email…",
  "reg.count": "{shown} / {total} Amazers",
  "reg.empty": "Chưa có Amazers nào đăng ký.",
  "reg.noMatch": "Không có Amazers nào khớp với tìm kiếm.",
  "reg.col.name": "Họ tên",
  "reg.col.domain": "Khối/Phòng",
  "reg.col.email": "Email",
  "reg.col.machine": "Máy",
  "reg.col.duration": "Thời lượng",
  "reg.col.regTime": "Thời gian đăng ký",
  "reg.col.status": "Trạng thái",
  "reg.col.edit": "Sửa",
  "reg.editTitle": "Sửa thông tin Amazer",
  "reg.machineFixed": "Máy: {machine} (không thể thay đổi)",
  "reg.required": "Họ tên, khối/phòng và email là bắt buộc.",
  "reg.current": "{d} (hiện tại)",

  // Moderator — gifts
  "gift.loading": "Đang tải quà tặng…",
  "gift.add": "Thêm quà tặng",
  "gift.name": "Tên",
  "gift.namePlaceholder": "vd: Cafe",
  "gift.qty": "Số lượng",
  "gift.adding": "Đang thêm…",
  "gift.addBtn": "Thêm quà",
  "gift.nameRequired": "Tên quà là bắt buộc.",
  "gift.qtyInvalid": "Số lượng phải là số nguyên không âm.",
  "gift.none": "Chưa có quà tặng nào.",
  "gift.col.gift": "Quà tặng",
  "gift.col.remaining": "Còn lại / Tổng",
  "gift.col.actions": "Hành động",
  "gift.editTitle": "Sửa quà tặng",
  "gift.total": "Tổng số lượng",
  "gift.remaining": "Số lượng còn lại",
  "gift.qtyNonNeg": "Số lượng phải là số nguyên không âm.",
  "gift.remGtTotal": "Số còn lại không thể lớn hơn tổng.",
  "gift.confirmDelete": "Xóa \"{name}\"? Không thể hoàn tác.",

  // Gift eligibility panel (derived, by duration tier)
  "elig.title": "Quà theo mức thời gian (người hoàn thành đầu tiên)",
  "elig.subtitle": "Xếp hạng theo thời điểm hoàn thành. {n} người đầu tiên ở mỗi mức nhận quà tương ứng.",
  "elig.tier": "Mức {d}",
  "elig.giftFor": "Quà: {gift}",
  "elig.slots": "{taken} / {total} suất đã trao · còn {left}",
  "elig.noFinishers": "Chưa có ai hoàn thành ở mức này.",
  "elig.rank": "Hạng",
  "elig.finishedAt": "Hoàn thành lúc",
  "elig.awarded": "Nhận quà",
  "elig.waitlist": "Ngoài suất",
  "elig.noTierGift": "Chưa cấu hình quà cho mức này (tạo quà tên \"{gift}\" ở tab Quà tặng).",

  // Moderator — config
  "cfg.loading": "Đang tải…",
  "cfg.statusTitle": "Trạng thái sự kiện",
  "cfg.started": "Đã bắt đầu",
  "cfg.startedAt": "lúc {time}",
  "cfg.notStarted": "Chưa bắt đầu",
  "cfg.title": "Cấu hình",
  "cfg.currentTime": "Giờ hiện tại (Việt Nam · UTC+7)",
  "cfg.startTime": "Thời gian bắt đầu sự kiện",
  "cfg.vnTime": "(giờ Việt Nam)",
  "cfg.savedStart": "Đã lưu giờ bắt đầu: {time}",
  "cfg.buffer": "Đệm (giây)",
  "cfg.durations": "Thời lượng chạy cho phép",
  "cfg.durationsHint": "Thêm thời lượng mới theo phút. Cần ít nhất một mục.",
  "cfg.noDurations": "Chưa có thời lượng nào — hãy thêm ít nhất một.",
  "cfg.addDurationOne": "Thêm ít nhất một thời lượng chạy.",
  "cfg.removeDuration": "Bỏ {d}",
  "cfg.newDuration": "Thời lượng mới (phút)",
  "cfg.machines": "Số lượng máy",
  "cfg.machinesLocked": "Đã khóa (sự kiện đã bắt đầu)",
  "cfg.startTitle": "Khởi động sự kiện",
  "cfg.startDesc": "Khởi động sẽ chốt thời gian dự kiến của từng người và khóa số lượng máy. Không thể hoàn tác.",
  "cfg.startBtn": "Khởi động sự kiện",
  "cfg.startedBtn": "Sự kiện đã bắt đầu",
  "cfg.startingBtn": "Đang khởi động…",
  "cfg.needStart": "Hãy đặt và lưu thời gian bắt đầu trước khi khởi động.",
  "cfg.startConfirm": "Thao tác này chốt thời gian dự kiến của mọi người và khóa số lượng máy. Tiếp tục?",
  "cfg.danger": "Khu vực nguy hiểm",
  "cfg.dangerDesc": "Khởi động lại sự kiện: xóa toàn bộ người tham gia và kết quả, khôi phục số lượng quà, và đưa sự kiện về trạng thái chưa bắt đầu. Máy, đệm, thời lượng, giờ bắt đầu và mã PIN được giữ nguyên. Dùng để xóa dữ liệu thử trước sự kiện thật. Không thể hoàn tác.",
  "cfg.resetBtn": "Khởi động lại dữ liệu",
  "cfg.resetting": "Đang xóa…",
  "cfg.resetDone": "Đã xóa dữ liệu sự kiện.",
  "cfg.resetConfirm": "KHỞI ĐỘNG LẠI DỮ LIỆU SỰ KIỆN?\n\nThao tác này XÓA VĨNH VIỄN mọi người tham gia và kết quả, khôi phục toàn bộ số lượng quà, và đưa sự kiện về chưa bắt đầu. Máy, đệm, thời lượng, giờ bắt đầu và PIN được giữ nguyên. Không thể hoàn tác.",

  // Moderator — export
  "exp.title": "Xuất dữ liệu",
  "exp.desc": "Tải toàn bộ dữ liệu đăng ký dưới dạng tệp CSV (UTF-8).",
  "exp.count": "{n} người tham gia sẽ được xuất.",
  "exp.download": "Tải CSV",
  "csv.name": "Họ tên",
  "csv.domain": "Khối/Phòng",
  "csv.email": "Email",
  "csv.machine": "Máy",
  "csv.duration": "Thời lượng chạy (giây)",
  "csv.regTime": "Thời gian đăng ký",
  "csv.originalEst": "Dự kiến ban đầu",
  "csv.actualStart": "Bắt đầu thực tế",
  "csv.actualFinish": "Hoàn thành thực tế",
  "csv.distance": "Quãng đường",
  "csv.gift": "Quà tặng",
  "csv.status": "Trạng thái",

  // Gate
  "gate.title": "Đăng nhập quản trị",
  "gate.pin": "Mã PIN",
  "gate.enter": "Vào",
  "gate.wrong": "Mã PIN không đúng.",
};

const en: Dict = {
  "lang.vi": "Tiếng Việt",
  "lang.en": "English",

  "common.refresh": "Refresh",
  "common.cancel": "Cancel",
  "common.save": "Save",
  "common.saving": "Saving…",
  "common.saved": "Saved.",
  "common.loading": "Loading…",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.wrong": "Something went wrong. Please try again.",

  "error.EMAIL_TAKEN": "That email is already signed up. Each email can only register once.",
  "error.INVALID_DURATION": "That run duration is not allowed. Please pick one from the list.",
  "error.INVALID_PIN": "Incorrect PIN.",
  "error.INVALID_EMAIL_DOMAIN": "Email must end with @mblife.vn.",
  "error.QUEUE_COUNT_LOCKED": "The number of machines cannot change after the event has started.",
  "error.QUEUE_COUNT_HAS_SIGNUPS": "Cannot change the number of machines once people have signed up.",
  "error.ALREADY_STARTED": "The event has already been started.",
  "error.NO_START_TIME": "Set an event start time before starting the event.",
  "error.UNKNOWN": "Something went wrong. Please try again.",

  "signup.title": "EnergySteps — Sign up to run",
  "signup.subtitle": "Reserve your spot, pick a run length, and we’ll assign you a machine.",
  "signup.name.label": "Name",
  "signup.name.placeholder": "Your name",
  "signup.domain.label": "Domain",
  "signup.domain.placeholder": "Select a domain…",
  "signup.email.label": "Email",
  "signup.email.placeholder": "you@mblife.vn",
  "signup.email.mblife": "Email must end with @mblife.vn.",
  "signup.duration.label": "Run duration",
  "signup.duration.choose": "Please choose a run duration.",
  "signup.submit": "Sign up",
  "signup.submitting": "Signing up…",
  "signup.checkStatus": "Check my status",
  "signup.loadError": "We couldn’t load the sign-up form right now. Please try again.",
  "signup.retry": "Retry",
  "signup.loading": "Loading sign-up form…",

  "confirm.done": "You’re signed up!",
  "confirm.machineLabel": "Your assigned machine:",
  "confirm.machineNote": "This machine is yours for the event — it won’t change.",
  "confirm.windowLabel": "Estimated check-in window",
  "confirm.noWindow": "Your estimated time will be available once the organizer sets the event start time — check the status page later.",
  "confirm.statusHint": "You can return anytime to look up your status by email on the {link}.",
  "confirm.statusPage": "status page",
  "confirm.again": "Sign up someone else",

  "status.title": "EnergySteps — My status",
  "status.subtitle": "Look up your spot in line and your projected check-in time.",
  "status.email.label": "Email",
  "status.lookup": "Look up",
  "status.lookingUp": "Looking up…",
  "status.notFound": "No sign-up found for that email.",
  "status.behind.tag": "Running behind",
  "status.behind.headline": "Running ~{n} minutes behind",
  "status.behind.newEta": "Your new estimated check-in is {time}",
  "status.onSchedule": "On schedule",
  "status.onSchedule.eta": "Estimated check-in at {time}",
  "status.assignedMachine": "Assigned machine",
  "status.originalEta": "Original estimated start",
  "status.setAtStart": "Set when the event starts",
  "status.currentEta": "Current projected start",
  "status.position": "Position in line",
  "status.upNext": "Up next",
  "status.statusLabel": "Status",
  "status.updated": "Updated {time}",
  "status.refreshing": "Refreshing…",
  "status.back": "← Back to sign-up",
  "status.s.finished": "You've finished — great job!",
  "status.s.skipped": "Your slot was skipped.",
  "status.s.no_show": "Marked as no-show.",
  "status.s.checked_in": "You're checked in — you're up!",
  "status.s.signed_up": "You're in the queue.",

  "st.signed_up": "Signed up",
  "st.checked_in": "Running",
  "st.finished": "Finished",
  "st.skipped": "Skipped",
  "st.no_show": "No-show",

  "mod.title": "EnergySteps · Moderator",
  "mod.tab.board": "Board",
  "mod.tab.registration": "Registration",
  "mod.tab.gifts": "Gifts",
  "mod.tab.config": "Config",
  "mod.tab.export": "Export",
  "mod.live": "Live",
  "mod.lock": "Lock",

  "board.loading": "Loading board…",
  "board.noQueues": "No queues configured yet. Set the number of machines in the Config tab.",
  "board.complete": "Complete",
  "board.noStartTime": "Set an event start time and Start the event in the Config tab.",
  "board.queueComplete": "✅ Queue complete — all Amazers done.",
  "board.awaitingCheckin": "Awaiting check-in · position {n}",
  "board.checkinWindow": "Check-in window",
  "board.autoStartNote": "Run time starts automatically when this reaches 0:00.",
  "board.checkIn": "Check in",
  "board.noShow": "No-show",
  "board.skip": "Skip",
  "board.running": "Running",
  "board.runningAuto": "Running (auto-started)",
  "board.position": "position {n}",
  "board.startedAt": "started {time}",
  "board.autoRunningNote": "Check-in window ended — the slot clock is running. Check them out when done.",
  "board.runRemaining": "Run time remaining",
  "board.slotElapsed": "Slot time elapsed — check them out to advance the queue.",
  "board.checkOut": "Check out",
  "board.checkOutTitle": "Check out {name}",
  "board.distance": "Distance logged (optional)",
  "board.gift": "Gift",
  "board.noGift": "No gift",
  "board.giftLeft": "{name} ({n} left)",
  "board.confirmCheckout": "Confirm check-out",
  "board.distanceNaN": "Distance must be a number, or leave it blank.",
  "board.confirmSkip": "Are you sure you want to {verb} {name}? This advances the queue.",
  "board.verb.no_show": "mark as a no-show",
  "board.verb.skipped": "skip",
  "board.upNext": "Up next",
  "board.noMore": "No more Amazers in line.",
  "board.doneCollapsed": "Finished & skipped ({n})",
  "board.logged": "{n} logged",
  "board.out": "out {time}",

  "reg.loading": "Loading registrations…",
  "reg.search.label": "Search Amazers",
  "reg.search.placeholder": "Filter by name or email…",
  "reg.count": "{shown} of {total} Amazers",
  "reg.empty": "No Amazers have signed up yet.",
  "reg.noMatch": "No Amazers match your search.",
  "reg.col.name": "Name",
  "reg.col.domain": "Domain",
  "reg.col.email": "Email",
  "reg.col.machine": "Machine",
  "reg.col.duration": "Duration",
  "reg.col.regTime": "Registration time",
  "reg.col.status": "Status",
  "reg.col.edit": "Edit",
  "reg.editTitle": "Edit Amazer",
  "reg.machineFixed": "Machine: {machine} (cannot be changed)",
  "reg.required": "Name, domain and email are required.",
  "reg.current": "{d} (current)",

  "gift.loading": "Loading gifts…",
  "gift.add": "Add a gift",
  "gift.name": "Name",
  "gift.namePlaceholder": "e.g. Cafe",
  "gift.qty": "Quantity",
  "gift.adding": "Adding…",
  "gift.addBtn": "Add gift",
  "gift.nameRequired": "Gift name is required.",
  "gift.qtyInvalid": "Quantity must be a non-negative whole number.",
  "gift.none": "No gifts yet.",
  "gift.col.gift": "Gift",
  "gift.col.remaining": "Remaining / Total",
  "gift.col.actions": "Actions",
  "gift.editTitle": "Edit gift",
  "gift.total": "Total quantity",
  "gift.remaining": "Remaining quantity",
  "gift.qtyNonNeg": "Quantities must be non-negative whole numbers.",
  "gift.remGtTotal": "Remaining quantity cannot exceed the total quantity.",
  "gift.confirmDelete": "Delete \"{name}\"? This cannot be undone.",

  "elig.title": "Gifts by duration tier (first finishers)",
  "elig.subtitle": "Ranked by finish time. The first {n} finishers in each tier receive the matching gift.",
  "elig.tier": "{d} tier",
  "elig.giftFor": "Gift: {gift}",
  "elig.slots": "{taken} / {total} awarded · {left} left",
  "elig.noFinishers": "No one has finished in this tier yet.",
  "elig.rank": "Rank",
  "elig.finishedAt": "Finished at",
  "elig.awarded": "Awarded",
  "elig.waitlist": "Over limit",
  "elig.noTierGift": "No gift configured for this tier (create a gift named \"{gift}\" in the Gifts tab).",

  "cfg.loading": "Loading…",
  "cfg.statusTitle": "Event status",
  "cfg.started": "Started",
  "cfg.startedAt": "at {time}",
  "cfg.notStarted": "Not started",
  "cfg.title": "Configuration",
  "cfg.currentTime": "Current time (Vietnam · UTC+7)",
  "cfg.startTime": "Event start time",
  "cfg.vnTime": "(Vietnam time)",
  "cfg.savedStart": "Saved start: {time}",
  "cfg.buffer": "Buffer (seconds)",
  "cfg.durations": "Allowed run durations",
  "cfg.durationsHint": "Add new durations in minutes. At least one is required.",
  "cfg.noDurations": "No durations yet — add at least one.",
  "cfg.addDurationOne": "Add at least one run duration.",
  "cfg.removeDuration": "Remove {d}",
  "cfg.newDuration": "New duration (minutes)",
  "cfg.machines": "Number of machines",
  "cfg.machinesLocked": "Locked (event started)",
  "cfg.startTitle": "Start event",
  "cfg.startDesc": "Starting captures each participant's immutable original estimated start time and locks the machine count. This cannot be undone.",
  "cfg.startBtn": "Start event",
  "cfg.startedBtn": "Event started",
  "cfg.startingBtn": "Starting…",
  "cfg.needStart": "Set and save an event start time before starting.",
  "cfg.startConfirm": "This captures everyone's estimated times and locks the machine count. Continue?",
  "cfg.danger": "Danger zone",
  "cfg.dangerDesc": "Restart the event: delete all participants and results, restore gift quantities, and un-start the event. Machines, buffer, durations, start time and PINs are kept. Use this to clear test data before the real event. This cannot be undone.",
  "cfg.resetBtn": "Restart event data",
  "cfg.resetting": "Resetting…",
  "cfg.resetDone": "Event data reset.",
  "cfg.resetConfirm": "RESTART EVENT DATA?\n\nThis permanently DELETES every participant and result, restores all gift quantities, and un-starts the event. Machines, buffer, durations, start time and PINs are kept. This cannot be undone.",

  "exp.title": "Export",
  "exp.desc": "Download all participant records as a CSV file (UTF-8).",
  "exp.count": "{n} participants will be exported.",
  "exp.download": "Download CSV",
  "csv.name": "Name",
  "csv.domain": "Domain",
  "csv.email": "Email",
  "csv.machine": "Machine",
  "csv.duration": "Run Duration (seconds)",
  "csv.regTime": "Registration Time",
  "csv.originalEst": "Original Estimate",
  "csv.actualStart": "Actual Start",
  "csv.actualFinish": "Actual Finish",
  "csv.distance": "Distance",
  "csv.gift": "Gift",
  "csv.status": "Status",

  "gate.title": "Moderator sign-in",
  "gate.pin": "PIN",
  "gate.enter": "Enter",
  "gate.wrong": "Incorrect PIN.",
};

const DICTS: Record<Lang, Dict> = { vi, en };

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "vi") return stored;
  } catch {
    // ignore (SSR / privacy mode)
  }
  return "vi"; // default: Vietnamese
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = DICTS[lang];
      const template = dict[key] ?? DICTS.en[key] ?? key;
      return interpolate(template, params);
    },
    [lang],
  );

  const value = useMemo<I18nValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used within I18nProvider");
  return v;
}

// Convenience: just the translate function.
export function useT() {
  return useI18n().t;
}

// EN/VI toggle button group.
export function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <div className={`inline-flex overflow-hidden rounded-full ring-1 ring-brand/40 ${className}`}>
      {(["vi", "en"] as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`px-3 py-1 text-xs font-semibold transition ${
            lang === l ? "bg-brand text-white" : "bg-white text-brand hover:bg-brand/10"
          }`}
          aria-pressed={lang === l}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
