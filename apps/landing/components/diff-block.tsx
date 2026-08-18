/** Illustrative preview of what Aster shows before it applies a change. */
export function DiffBlock() {
  return (
    <div className="mt-auto px-7 pt-2 pb-7 sm:px-8 lg:p-0">
      <div
        aria-hidden="true"
        className="overflow-x-auto rounded-[14px] bg-[#26252a] p-4 font-mono text-xs leading-[1.7]"
      >
        <pre className="whitespace-pre text-[#b8b8be]">
          <span className="text-[#6e6e76]"># preview · Deployment/api-server</span>
          {"\n  replicas:\n"}
          <span className="text-[#ff9f8a]">-   3</span>
          {"\n"}
          <span className="text-[#7ddba3]">+   5</span>
          {"\n  image:\n"}
          <span className="text-[#ff9f8a]">-   api:1.4.1</span>
          {"\n"}
          <span className="text-[#7ddba3]">+   api:1.5.0</span>
          {"\n"}
          <span className="text-[#6e6e76]">  ✓ nothing else will change</span>
        </pre>
      </div>
    </div>
  );
}
