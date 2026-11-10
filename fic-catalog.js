---
layout: null
permalink: /fic-data/catalog.js
---
{%- assign fields = 'schemaVersion,title,author,summary,rating,language,languageCode,wordCount,wordCountSource,chaptersAvailable,chaptersPosted,chaptersTotal,completionStatus,publishedAt,updatedAt,completedAt' | split: ',' -%}
{%- assign lists = 'warning,category,fandom,relationship,characters,additionalTags,collections' | split: ',' -%}
{%- assign comma = '' -%}
window.RADIOAPPLE_CATALOG_VERSION = 2;
window.RADIOAPPLE_CATALOG = [
{%- for fic in site.fics -%}
  {%- assign extension = fic.path | split: '.' | last -%}
  {%- assign id = fic.url | remove_first: '/fic-data/' | split: '/' | first -%}
  {%- if extension == 'md' and fic.title and fic.title != '' and id != '' -%}
    {{ comma }}{
      "id": {{ id | jsonify }}
      {%- for field in fields -%}
        {%- assign value = fic[field] -%}
        ,{{ field | jsonify }}:{% include catalog-value.html value=value %}
      {%- endfor -%}
      {%- for field in lists -%}
        {%- assign value = fic[field] -%}
        ,{{ field | jsonify }}:{% include catalog-value.html value=value string_list=true %}
      {%- endfor -%}
      ,"creators":{% include catalog-records.html values=fic.creators field='name' %}
      ,"series":{% include catalog-records.html values=fic.series field='title' position=true %}
      ,"stats":{% if fic.stats %}{
        {%- assign stats = 'hits,kudos,comments,bookmarks,asOf' | split: ',' -%}
        {%- for field in stats -%}
          {%- unless forloop.first -%},{%- endunless -%}
          {%- assign value = fic.stats[field] -%}
          {{ field | jsonify }}:{% include catalog-value.html value=value %}
        {%- endfor -%}
      }{% else %}null{% endif %}
      ,"source":{% include catalog-source.html source=fic.source %}
    }
    {%- assign comma = ',' -%}
  {%- endif -%}
{%- endfor -%}
];
