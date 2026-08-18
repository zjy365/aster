import Image from "next/image";
import { asset } from "@/lib/content";

type Shot = { src: string; alt: string; width: number; height: number };

/**
 * macOS-style window chrome around a product screenshot.
 * `crop` clamps the image height for the bento cards; the hero renders full.
 */
export function WindowFrame({
  title,
  shot,
  crop,
  priority = false,
}: {
  title?: string;
  shot: Shot;
  crop?: string;
  priority?: boolean;
}) {
  return (
    <div className="rounded-[22px] border border-hairline-soft bg-surface-muted p-1.5 shadow-[0_2px_6px_rgb(0_0_0/0.05),0_32px_80px_rgb(30_25_20/0.12)] sm:rounded-[26px] sm:p-2">
      <div className="overflow-hidden rounded-[17px] border border-hairline-soft bg-surface sm:rounded-[20px]">
        {title ? (
          <div className="relative flex items-center border-b border-hairline-soft bg-surface px-4 py-3">
            <div className="flex flex-none gap-[7px]" aria-hidden="true">
              <span className="h-[11px] w-[11px] rounded-full border border-black/8 bg-[#ff5f57]" />
              <span className="h-[11px] w-[11px] rounded-full border border-black/8 bg-[#febc2e]" />
              <span className="h-[11px] w-[11px] rounded-full border border-black/8 bg-[#28c840]" />
            </div>
            <span className="pointer-events-none absolute inset-x-0 truncate px-16 text-center text-[12.5px] font-medium text-ink-3">
              {title}
            </span>
          </div>
        ) : null}
        <Image
          src={asset(shot.src)}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          priority={priority}
          sizes="(max-width: 1160px) 100vw, 1080px"
          className={crop ? `w-full object-cover object-left-top ${crop}` : "block h-auto w-full"}
        />
      </div>
    </div>
  );
}
