/**
 * ★ InlinePulse — বোতাম/ইনপুটের পাশে বসার মতো ক্ষুদ্র ইঙ্গিত।
 *
 *   ওভারলে নয়, তাই পূর্ণ ম্যাসকট এখানে বসানো যায় না (১৮px-এ বিড়াল
 *   কাদা হয়ে যেত)। কিন্তু **একই ভাষা**: সেই শক্তি-গোলকের কক্ষপথ ও
 *   লাইম আভা — ঘূর্ণায়মান স্পিনার নয়।
 *
 *   ⚠️ কোডবেসে ঘূর্ণায়মান স্পিনার নিষিদ্ধ; এটিই একমাত্র অনুমোদিত
 *   ইনলাইন লোডিং-চিহ্ন।
 */
export default function InlinePulse({
  size = 18,
  className = '',
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`nv-pulse inline-block shrink-0 align-middle ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <i /><i /><i />
    </span>
  );
}
