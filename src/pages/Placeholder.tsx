import { ThemeDecor, type DecorVariant } from "../components/decor/ThemeDecor";

export function Placeholder({ title, variant }: { title: string; variant?: DecorVariant }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="empty">
        <ThemeDecor slot="empty" variant={variant ?? "home"} />
        <p>준비 중</p>
      </div>
    </>
  );
}
