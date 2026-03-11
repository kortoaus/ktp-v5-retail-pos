import React from "react";
import { CloudPostContentType } from "../types/models";

function renderMarks(
  text: string,
  marks?: { type: string; attrs?: Record<string, any> }[],
): React.ReactNode {
  if (!marks || marks.length === 0) return text;

  return marks.reduce<React.ReactNode>((acc, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{acc}</strong>;
      case "italic":
        return <em>{acc}</em>;
      case "underline":
        return <u>{acc}</u>;
      case "strike":
        return <s>{acc}</s>;
      case "code":
        return <code>{acc}</code>;
      case "link":
        return (
          <a href={mark.attrs?.href} target="_blank" rel="noopener noreferrer">
            {acc}
          </a>
        );
      default:
        return acc;
    }
  }, text);
}

function renderNode(
  node: CloudPostContentType,
  index: number,
): React.ReactNode {
  if (node.type === "text") {
    return (
      <React.Fragment key={index}>
        {renderMarks(node.text ?? "", node.marks)}
      </React.Fragment>
    );
  }

  const children = node.content?.map((child, i) => renderNode(child, i));

  switch (node.type) {
    case "paragraph":
      return (
        <p className="text-lg" key={index}>
          {children}
        </p>
      );
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level ?? 1, 1), 6);
      if (level === 1) return <h1 key={index}>{children}</h1>;
      if (level === 2) return <h2 key={index}>{children}</h2>;
      if (level === 3) return <h3 key={index}>{children}</h3>;
      if (level === 4) return <h4 key={index}>{children}</h4>;
      if (level === 5) return <h5 key={index}>{children}</h5>;
      return <h6 key={index}>{children}</h6>;
    }
    case "bulletList":
      return <ul key={index}>{children}</ul>;
    case "orderedList":
      return <ol key={index}>{children}</ol>;
    case "listItem":
      return <li key={index}>{children}</li>;
    case "blockquote":
      return <blockquote key={index}>{children}</blockquote>;
    case "codeBlock":
      return (
        <pre key={index}>
          <code>{children}</code>
        </pre>
      );
    case "hardBreak":
      return <br key={index} />;
    case "image":
      return (
        <img key={index} src={node.attrs?.src} alt={node.attrs?.alt ?? ""} />
      );
    default:
      return <div key={index}>{children}</div>;
  }
}

export default function TiptapContentRenderer({
  content,
}: {
  content: CloudPostContentType;
}) {
  if (content.type !== "doc" || !content.content) return null;

  return <div>{content.content.map((node, i) => renderNode(node, i))}</div>;
}
