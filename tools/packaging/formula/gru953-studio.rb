# Homebrew formula for the GRU953-Studio command.
#
# Publish by copying this into a "Formula" folder in a public repository named
# GRU-953/homebrew-tap — see ../README.md for the step-by-step. Homebrew core is
# deliberately not attempted; its notability criteria are Homebrew's to judge.
#
# This installs the npm package and depends on Node, and does nothing else. It
# does NOT run "gru953-studio install" on the user's behalf: that step finds
# their AI coding tools and writes into their configuration, which is not
# something a package manager should do without being asked.
class Gru953Studio < Formula
  desc "AI project lead plus a team of specialist AI developers, for non-technical people"
  homepage "https://github.com/GRU-953/GRU953-Studio"
  url "https://registry.npmjs.org/@gru953/studio-cli/-/studio-cli-5.1.4.tgz"
  # Replace with the real checksum of the .tgz above before publishing:
  #   curl -sL <url> | shasum -a 256
  sha256 "REPLACE_WITH_THE_TARBALL_SHA256"
  license "PolyForm-Noncommercial-1.0.0"
  version "5.1.4"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  def caveats
    <<~EOS
      To finish setting up, run:
        gru953-studio install

      That looks for Claude Code, Claude Desktop, Google Antigravity, VS Code,
      Cursor and Windsurf on this computer and sets the studio up in each one it
      finds. It asks before changing anything.
    EOS
  end

  test do
    assert_match "GRU953-Studio", shell_output("#{bin}/gru953-studio help")
  end
end
