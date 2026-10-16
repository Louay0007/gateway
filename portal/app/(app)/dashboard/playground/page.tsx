import { Metadata } from "next";

import { Playground } from "./playground-client";

export const metadata: Metadata = { title: "Playground" };

export default function PlaygroundPage() {
  return <Playground />;
}
