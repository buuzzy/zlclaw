# typed: false
# frozen_string_literal: true

cask "workany" do
  arch arm: "aarch64", intel: "a886e6693a5740e58a12a0ee639b922cb16264a7057952c029bf2d8e372c314b"

  version "0.1.19"
  sha256 arm:   "795fdf5f0c8b8e086e140847b4115de428cec1950e35ebc99969751f61fdabc3",
         intel: "a886e6693a5740e58a12a0ee639b922cb16264a7057952c029bf2d8e372c314b"

  url "https://github.com/workany-ai/workany/releases/download/v#{version}/WorkAny_#{version}_#{arch}.dmg",
      verified: "github.com/workany-ai/workany/"
  name "WorkAny"
  desc "AI-powered work assistant with Claude Code and Codex integration"
  homepage "https://github.com/workany-ai/workany"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "WorkAny.app"

  postflight do
    # Remove quarantine attribute to prevent Gatekeeper issues
    system_command "/usr/bin/xattr",
                   args: ["-r", "-d", "com.apple.quarantine", "#{appdir}/WorkAny.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/ai.thinkany.workany",
    "~/Library/Caches/ai.thinkany.workany",
    "~/Library/Logs/ai.thinkany.workany",
    "~/Library/Preferences/ai.thinkany.workany.plist",
    "~/Library/Saved Application State/ai.thinkany.workany.savedState",
  ]
end
