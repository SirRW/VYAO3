(function (root) {
  'use strict';

  // AU is an explicit local alias. The Canon chain and divergence aliases are
  // documented on AO3's Alternate Universe - Canon Divergence tag page.
  const relationships = [
    { type: 'additionalTags', canonical: 'Alternate Universe', aliases: ['AU'] },
    { type: 'additionalTags', canonical: 'Alternate Universe - Canon', parents: ['Alternate Universe'] },
    { type: 'additionalTags', canonical: 'Alternate Universe - Canon Divergence',
      aliases: ['AU - Canon Divergence', 'Canon Divergence'], parents: ['Alternate Universe - Canon'] }
  ];

  if (typeof module === 'object' && module.exports) module.exports = relationships;
  else (root.RadioAppleDiscovery ||= {}).tagRelationships = relationships;
})(globalThis);
