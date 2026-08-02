import { isUnexpandedVotePlaceholder, repairVoteBelowMarker } from "../core/voting-wikitext.js";

export function reviseVotingPage(wikiText: string): string {
  const collapseText = "{{Collapse top|Current votes – please choose your own winners before looking}}";
  const lines = ["{{Discussion top}}"]; 

  for (const rawLine of wikiText.split(/\r?\n/)) {
    let line = repairVoteBelowMarker(rawLine);

    if (line.startsWith("{{Discussion top}}") || line.startsWith("{{Discussion bottom}}")) {
      continue;
    }

    if (isUnexpandedVotePlaceholder(line.trim())) {
      continue;
    }

    if (line.startsWith("<!-- '''Creator")) {
      line = line.replace("<!-- ", "").replace(" -->", "").replace(collapseText, "");
    } else if (line.startsWith("{{Collapse bottom}}")) {
      continue;
    } else if (line.startsWith("'''Voting will end") || line.startsWith("'''Voting ended")) {
      line = line.replace("Voting will end", "Voting ended");
    }
    lines.push(line);
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  lines.push("{{Discussion bottom}}");
  return `${lines.join("\n")}\n`;
}
