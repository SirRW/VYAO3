require "fileutils"
require "find"
require "json"
require "tmpdir"

if ARGV.delete("--portable")
  gem "kramdown", "2.4.0"

  # Some Windows shells return no matches from the portable runtime's glob.
  module PortableJekyllGlob
    def [](*patterns, **options)
      matches = super
      pattern = patterns.first
      if matches.empty? && patterns.length == 1 && pattern.is_a?(String) &&
         pattern.include?("/jekyll/") && pattern.end_with?("/*.rb")
        return files_with_extension(pattern, ".rb")
      end
      matches
    end

    def glob(pattern, *args, **options, &block)
      matches = super
      if !block && matches.empty? && pattern.is_a?(String) && pattern.end_with?("/_fics/*.md")
        return files_with_extension(pattern, ".md")
      end
      matches
    end

    private

    def files_with_extension(pattern, extension)
      folder = File.dirname(pattern)
      return [] unless File.directory?(folder)

      children(folder).select { |name| name.end_with?(extension) }.sort.map { |name| File.join(folder, name) }
    end
  end

  Dir.singleton_class.prepend(PortableJekyllGlob)
end

require "jekyll"

ROOT = File.expand_path("..", __dir__)
ASSETS = %w[_config.yml _layouts _includes fic-catalog.js index.html app.js styles.css browse.css ao3-logo.png].freeze
SNAPSHOT = /\A(ao3-[0-9]+|local-[a-f0-9]{20})--([a-f0-9]{64})\.md\z/
STAGED_NAME = /\A(?:ao3|local)-.*--.*\.md\z/
PREVIEW_PREFERENCE = { "epub" => 2, "docx" => 1 }.freeze

def build(source, destination)
  config = Jekyll.configuration("safe" => true, "source" => source, "destination" => destination)
  Jekyll::Site.new(config).process
end

def markdown_files(folder)
  return [] unless File.directory?(folder)

  Dir.children(folder).filter_map do |name|
    path = File.join(folder, name)
    path if name.end_with?(".md") && File.file?(path) && !File.symlink?(path)
  end.sort
end

def prepare_source(source)
  ASSETS.each { |name| FileUtils.cp_r(File.join(ROOT, name), source) }
  discovery = File.join(source, "discovery")
  Dir.mkdir(discovery)
  Dir.children(File.join(ROOT, "discovery")).sort.each do |name|
    path = File.join(ROOT, "discovery", name)
    FileUtils.cp(path, discovery) if name.end_with?(".js", ".css") && File.file?(path) && !File.symlink?(path)
  end
  fics = File.join(source, "_fics")
  Dir.mkdir(fics)
  works = markdown_files(File.join(ROOT, "_fics"))
  works.reject { |path| File.basename(path).match?(STAGED_NAME) }.each { |path| FileUtils.cp(path, fics) }
  fics
end

def install_pages(site, destination, previous)
  if File.exist?(destination) || File.symlink?(destination)
    unless File.directory?(destination) && File.realpath(destination) == File.join(File.realpath(ROOT), "_pages") &&
           File.file?(File.join(destination, ".nojekyll"))
      abort "The _pages folder already exists and is not a generated Pages export."
    end
    File.rename(destination, previous)
  end
  begin
    File.rename(site, destination)
  rescue SystemCallError
    File.rename(previous, destination) if File.exist?(previous)
    raise
  end
end

def verify_pages(site)
  required = %w[index.html app.js styles.css browse.css ao3-logo.png fic-data/catalog.js]
  files = Find.find(site).reject { |path| File.directory?(path) }.map { |path| path.delete_prefix("#{site}/") }
  missing = required - files
  abort "Pages export is missing #{missing.join(', ')}." unless missing.empty?

  files.each do |file|
    if (work = /\Afic-data\/([a-z0-9-]+)\/work\.js\z/.match(file))
      next unless "#{work[1]}.md".match?(STAGED_NAME)
    elsif required.include?(file) || file.match?(%r{\Adiscovery/[a-z0-9-]+\.(?:js|css)\z})
      next
    end
    abort "Unexpected file in Pages export: #{file}"
  end
end

def export_pages
  local = File.join(ROOT, ".radioapple-import")
  FileUtils.mkdir_p(local)
  File.open(File.join(local, "pages.lock"), "a") do |lock|
    abort "A Pages export is already running." unless lock.flock(File::LOCK_EX | File::LOCK_NB)

    Dir.mktmpdir("pages-", local) do |folder|
      source = File.join(folder, "source")
      site = File.join(folder, "site")
      Dir.mkdir(source)
      prepare_source(source)
      build(source, site)
      verify_pages(site)
      File.write(File.join(site, ".nojekyll"), "")
      install_pages(site, File.join(ROOT, "_pages"), File.join(folder, "previous"))
      puts "Pages files are ready in _pages. This command did not upload them."
    end
  end
end

def preview_entries
  manifest = File.join(ROOT, ".radioapple-import", "manifest.json")
  return {} unless File.file?(manifest)

  entries = JSON.parse(File.read(manifest, encoding: "UTF-8"))["entries"]
  entries.is_a?(Hash) ? entries : {}
rescue JSON::ParserError, TypeError
  {}
end

def preview_priority(path, entries)
  id, hash = SNAPSHOT.match(File.basename(path)).captures
  record = entries[hash]
  record.is_a?(Hash) && record["workId"] == id ? PREVIEW_PREFERENCE.fetch(record["format"], 0) : 0
end

if ARGV == ["--preview"]
  Dir.mktmpdir("radioapple-preview-") do |source|
    fics = prepare_source(source)
    staged = markdown_files(File.join(ROOT, "_fics")) + markdown_files(File.join(ROOT, ".radioapple-import", "works"))
    snapshots = staged.group_by { |path| SNAPSHOT.match(File.basename(path))&.[](1) }
    snapshots.delete(nil)
    entries = preview_entries
    snapshots.each do |id, paths|
      target = File.join(fics, "#{id}.md")
      next if File.exist?(target)
      ranked = paths.group_by { |path| preview_priority(path, entries) }
      paths = ranked.fetch(ranked.keys.max)
      unless paths.drop(1).all? { |path| FileUtils.compare_file(paths.first, path) }
        warn "Skipping #{id}: conflicting local copies."
        next
      end
      FileUtils.cp(paths.first, target)
    end
    build(source, File.join(ROOT, ".radioapple-import", "preview"))
  end
elsif ARGV == ["--pages"]
  export_pages
elsif ARGV.empty?
  build(ROOT, File.join(ROOT, "_site"))
else
  abort "Usage: ruby tools/build-library.rb [--portable] [--preview | --pages]"
end
