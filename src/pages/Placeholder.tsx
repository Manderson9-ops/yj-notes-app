import { ThemeDecor } from "../components/decor/ThemeDecor";

export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="empty">
        <ThemeDecor slot="empty" />
        <p>준비 중</p>
      </div>
    </>
  );
}
