---
layout: null
permalink: /fic-data/catalog.js
---
{%- assign fields = 'title,author,summary,rating,warning,category,fandom,relationship,characters,additionalTags,language' | split: ',' -%}
{%- assign comma = '' -%}
window.RADIOAPPLE_CATALOG = [
{%- for fic in site.fics -%}
  {%- assign extension = fic.path | split: '.' | last -%}
  {%- if extension == 'md' and fic.title and fic.title != '' -%}
    {{ comma }}{
      "id": {{ fic.url | remove_first: '/fic-data/' | split: '/' | first | jsonify }}
      {%- for field in fields -%}
        ,{{ field | jsonify }}: {{ fic[field] | jsonify }}
      {%- endfor -%}
    }
    {%- assign comma = ',' -%}
  {%- endif -%}
{%- endfor -%}
];
