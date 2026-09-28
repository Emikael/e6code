Pod::Spec.new do |s|
  s.name           = 'E6NativeControls'
  s.version        = '1.0.0'
  s.summary        = 'Native UIKit controls for E6 Code mobile.'
  s.description    = 'UIKit-backed controls that match native iOS navigation chrome.'
  s.author         = 'E6 Tools'
  s.homepage       = 'https://e6.codes'
  s.platforms      = {
    :ios => '18.0',
  }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
