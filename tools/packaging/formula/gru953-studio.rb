# Homebrew formula for the GRU953-Studio command.
#
# This installs the `gru953-studio` command and nothing else. It deliberately does
# NOT run `gru953-studio install` afterwards: that step looks for the AI coding
# tools on the machine and writes into their configuration, which is not something
# a package manager should do to somebody without being asked. The caveats below
# tell the user the one command to run when they are ready.
#
# Kept in step with the copy in the main repository at
# tools/packaging/formula/gru953-studio.rb.
class Gru953Studio < Formula
  desc "AI project lead and specialist AI developer team for non-technical people"
  homepage "https://github.com/GRU-953/GRU953-Studio"
  url "https://registry.npmjs.org/@gru953/studio-cli/-/studio-cli-6.0.1.tgz"
  sha256 "5eb754eb92677f8992382be7cc251ec4b0f452947cb7dd06102b14b16d352e3f"
  license "PolyForm-Noncommercial-1.0.0"

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
      Cursor and Windsurf on this computer, and sets the studio up in each one it
      finds. It asks before it changes anything, and it never installs system
      software on your behalf.

      To check everything is in place at any time:
        gru953-studio doctor
    EOS
  end

  test do
    # Proves the command is genuinely installed and runnable, not merely present.
    assert_match "GRU953-Studio", shell_output("#{bin}/gru953-studio help")
    # Proves it can inspect a real directory without a project in it, which is the
    # state every new user starts from.
    assert_match(/GRU953-Studio/, shell_output("#{bin}/gru953-studio status"))
  end
end
